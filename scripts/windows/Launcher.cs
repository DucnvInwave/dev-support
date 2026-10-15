using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

[assembly: AssemblyTitle("Devkit")]
[assembly: AssemblyDescription("Firebase, Android, JSON and CSV tools")]
[assembly: AssemblyProduct("Devkit")]
[assembly: AssemblyVersion("__ASSEMBLY_VERSION__")]

namespace DevkitDesktop
{
    internal sealed class Runtime : IDisposable
    {
        internal const string PayloadHash = "__PAYLOAD_HASH__";
        internal const string Version = "__APP_VERSION__";
        internal string Home, Data, Url;
        internal Process Server;
        private string instance = Guid.NewGuid().ToString("N");
        private readonly object logLock = new object();
        private string recentOutput = "";
        private string runtimeDirectory;

        internal Runtime()
        {
            Home = Environment.GetEnvironmentVariable("DEVKIT_DESKTOP_HOME");
            if (String.IsNullOrWhiteSpace(Home))
                Home = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Devkit");
            Home = Path.GetFullPath(Home);
            Data = Environment.GetEnvironmentVariable("DEVKIT_DATA_DIR");
            if (String.IsNullOrWhiteSpace(Data)) Data = Path.Combine(Home, "data");
            Data = Path.GetFullPath(Data);
            Directory.CreateDirectory(Home);
            Directory.CreateDirectory(Data);
        }

        internal string StateFile { get { return Path.Combine(Home, "desktop-port.txt"); } }

        private bool ValidCache(string directory)
        {
            try
            {
                return File.ReadAllText(Path.Combine(directory, "payload.sha256")) == PayloadHash
                    && File.Exists(Path.Combine(directory, "node.exe"))
                    && File.Exists(Path.Combine(directory, "server", "index.mjs"))
                    && File.Exists(Path.Combine(directory, "public", "index.html"));
            }
            catch { return false; }
        }

        internal void Extract()
        {
            string cacheRoot = Path.Combine(Home, "runtime");
            Directory.CreateDirectory(cacheRoot);
            string destination = Path.Combine(cacheRoot, PayloadHash.Substring(0, 16));
            if (ValidCache(destination)) { runtimeDirectory = destination; return; }
            if (Directory.Exists(destination)) destination += "-repair-" + Guid.NewGuid().ToString("N");
            string temporary = Path.Combine(cacheRoot, ".extract-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(temporary);
            try
            {
                using (Stream payload = Assembly.GetExecutingAssembly().GetManifestResourceStream("Devkit.Payload.zip"))
                {
                    if (payload == null) throw new IOException("Khong tim thay goi du lieu Devkit.");
                    using (SHA256 hash = SHA256.Create())
                    {
                        string actual = BitConverter.ToString(hash.ComputeHash(payload)).Replace("-", "").ToLowerInvariant();
                        if (actual != PayloadHash) throw new IOException("Goi Devkit bi hong. Hay tai lai file exe.");
                    }
                    payload.Position = 0;
                    using (ZipArchive archive = new ZipArchive(payload, ZipArchiveMode.Read))
                    {
                        string prefix = Path.GetFullPath(temporary) + Path.DirectorySeparatorChar;
                        foreach (ZipArchiveEntry entry in archive.Entries)
                        {
                            string target = Path.GetFullPath(Path.Combine(temporary, entry.FullName));
                            if (!target.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                                throw new IOException("Duong dan trong goi Devkit khong hop le.");
                            if (String.IsNullOrEmpty(entry.Name)) { Directory.CreateDirectory(target); continue; }
                            Directory.CreateDirectory(Path.GetDirectoryName(target));
                            using (Stream input = entry.Open())
                            using (FileStream output = new FileStream(target, FileMode.CreateNew, FileAccess.Write))
                                input.CopyTo(output);
                        }
                    }
                }
                File.WriteAllText(Path.Combine(temporary, "payload.sha256"), PayloadHash);
                Directory.Move(temporary, destination);
                runtimeDirectory = destination;
            }
            finally
            {
                if (Directory.Exists(temporary))
                {
                    string target = Path.GetFullPath(temporary);
                    string prefix = Path.GetFullPath(cacheRoot) + Path.DirectorySeparatorChar;
                    if (target.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) Directory.Delete(target, true);
                }
            }
        }

        private static int FreePort()
        {
            for (int port = 3210; port < 3260; port++)
            {
                TcpListener probe = new TcpListener(IPAddress.Loopback, port);
                try { probe.Start(); return port; }
                catch (SocketException) { }
                finally { probe.Stop(); }
            }
            throw new IOException("Cac cong 3210-3259 dang duoc su dung. Hay dong mot ban Devkit khac roi thu lai.");
        }

        private void Log(string text)
        {
            if (String.IsNullOrEmpty(text)) return;
            lock (logLock)
            {
                recentOutput += text + Environment.NewLine;
                if (recentOutput.Length > 12000) recentOutput = recentOutput.Substring(recentOutput.Length - 12000);
                try { File.WriteAllText(Path.Combine(Home, "launcher.log"), recentOutput, Encoding.UTF8); } catch { }
            }
        }

        internal static string Get(string url, string expectedInstance)
        {
            // Use IPv4 explicitly: the backend binds 127.0.0.1, not the IPv6 localhost address.
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create(url.Replace("http://localhost:", "http://127.0.0.1:"));
            request.Proxy = null;
            request.Timeout = 1800;
            request.ReadWriteTimeout = 1800;
            using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
            {
                if (expectedInstance != null && response.Headers["X-Devkit-Instance"] != expectedInstance)
                    throw new IOException("Cong nay dang duoc ung dung khac su dung.");
                using (StreamReader reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
                    return reader.ReadToEnd();
            }
        }

        internal void Start()
        {
            Extract();
            int port = FreePort();
            Url = "http://localhost:" + port;
            string node = Path.Combine(runtimeDirectory, "node.exe");
            ProcessStartInfo info = new ProcessStartInfo(node, "\"" + Path.Combine(runtimeDirectory, "server", "index.mjs") + "\"");
            info.WorkingDirectory = runtimeDirectory;
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
            info.WindowStyle = ProcessWindowStyle.Hidden;
            info.RedirectStandardOutput = true;
            info.RedirectStandardError = true;
            info.StandardOutputEncoding = Encoding.UTF8;
            info.StandardErrorEncoding = Encoding.UTF8;
            info.EnvironmentVariables["PORT"] = port.ToString();
            info.EnvironmentVariables["DEVKIT_DATA_DIR"] = Data;
            info.EnvironmentVariables["DEVKIT_DESKTOP_INSTANCE"] = instance;
            info.EnvironmentVariables["PATH"] = runtimeDirectory + Path.PathSeparator + (info.EnvironmentVariables["PATH"] ?? "");
            Server = new Process();
            Server.StartInfo = info;
            Server.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e) { Log(e.Data); };
            Server.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e) { Log(e.Data); };
            if (!Server.Start()) throw new IOException("Khong khoi dong duoc backend Devkit.");
            Server.BeginOutputReadLine();
            Server.BeginErrorReadLine();
            Exception last = null;
            for (int i = 0; i < 100; i++)
            {
                if (Server.HasExited) throw new IOException("Devkit khong khoi dong duoc.\n" + recentOutput);
                try
                {
                    Get(Url + "/api/health", instance);
                    File.WriteAllText(StateFile, Url + "\n" + instance);
                    return;
                }
                catch (Exception e) { last = e; if (i == 0) Log("Startup probe: " + e.Message); Thread.Sleep(150); }
            }
            throw new IOException("Qua thoi gian cho khoi dong Devkit.", last);
        }

        internal bool RunningJob()
        {
            try { return Get(Url + "/api/jobs", instance).Contains("\"status\":\"running\""); }
            catch { return false; }
        }

        internal static void OpenUrl(string url)
        {
            Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
        }

        internal bool OpenExisting()
        {
            try
            {
                string[] state = File.ReadAllLines(StateFile);
                Uri uri;
                if (state.Length < 2 || !Uri.TryCreate(state[0], UriKind.Absolute, out uri)
                    || uri.Scheme != "http" || uri.Host != "localhost" || uri.Port < 3210 || uri.Port >= 3260) return false;
                Get(state[0] + "/api/health", state[1]);
                OpenUrl(state[0]);
                return true;
            }
            catch { return false; }
        }

        internal void SmokeTest()
        {
            Start();
            string session = Get(Url + "/api/session", instance);
            if (!session.Contains("\"token\":") || !session.Contains("\"settings\":"))
                throw new IOException("API session failed.");
            string[] assets = { "/", "/styles.css", "/app.js", "/json-tools.js", "/json-ui.js", "/csv-tools.js", "/csv-ui.js", "/favicon.svg" };
            foreach (string asset in assets)
                if (Get(Url + asset, instance).Length == 0) throw new IOException("Missing asset " + asset);
            string health = Get(Url + "/api/health", instance);
            string report = "Devkit " + Version + "\nPASS: bundled Node, backend API and all frontend assets\n" + health;
            File.WriteAllText(Path.Combine(Home, "smoke-test.txt"), report, Encoding.UTF8);
            Console.WriteLine(report);
        }

        public void Dispose()
        {
            if (Server == null) return;
            try
            {
                if (!Server.HasExited)
                {
                    string taskkill = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "taskkill.exe");
                    ProcessStartInfo stop = new ProcessStartInfo(taskkill, "/PID " + Server.Id + " /T /F");
                    stop.UseShellExecute = false;
                    stop.CreateNoWindow = true;
                    stop.WindowStyle = ProcessWindowStyle.Hidden;
                    using (Process killer = Process.Start(stop)) killer.WaitForExit(5000);
                    if (!Server.WaitForExit(5000)) Server.Kill();
                }
            }
            catch { try { if (!Server.HasExited) Server.Kill(); } catch { } }
            Server.Dispose();
            Server = null;
        }
    }

    internal sealed class MainWindow : Form
    {
        private Runtime runtime;
        private Label status;
        private Button open;
        private NotifyIcon tray;
        private bool ready;
        private bool starting = true;
        private bool exitRequested;
        private System.Windows.Forms.Timer healthTimer;

        internal MainWindow(Runtime service)
        {
            runtime = service;
            Text = "Devkit " + Runtime.Version;
            ClientSize = new Size(660, 360);
            MinimumSize = new Size(620, 390);
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(247, 248, 244);
            ForeColor = Color.FromArgb(44, 53, 44);
            Font = new Font("Segoe UI", 11);
            AutoScaleMode = AutoScaleMode.Dpi;
            MaximizeBox = false;
            Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            Label title = new Label { Text = "devkit.", Font = new Font("Segoe UI", 28, FontStyle.Bold), Location = new Point(28, 20), Size = new Size(590, 60) };
            Label subtitle = new Label { Text = "Firebase · Android · JSON · CSV", Location = new Point(32, 85), Size = new Size(590, 30) };
            status = new Label { Text = "Đang chuẩn bị ứng dụng, bạn chờ một chút nhé…", Location = new Point(32, 132), Size = new Size(590, 55) };
            open = new Button { Text = "Mở Devkit", Enabled = false, Location = new Point(32, 205), Size = new Size(190, 48), BackColor = Color.FromArgb(76, 103, 65), ForeColor = Color.White, FlatStyle = FlatStyle.Flat };
            open.FlatAppearance.BorderSize = 0;
            open.Click += delegate { OpenBrowser(); };
            Button exit = new Button { Text = "Dừng và thoát", Location = new Point(238, 205), Size = new Size(175, 48) };
            exit.Click += delegate { RequestExit(); };
            LinkLabel data = new LinkLabel { Text = "Mở thư mục dữ liệu", Location = new Point(32, 278), Size = new Size(260, 28), LinkColor = Color.FromArgb(76, 103, 65) };
            data.LinkClicked += delegate { Process.Start(new ProcessStartInfo("explorer.exe", "\"" + runtime.Data + "\"") { UseShellExecute = true }); };
            Label note = new Label { Text = "Nút X hoặc thu nhỏ sẽ ẩn xuống khay hệ thống và giữ ứng dụng chạy.", Location = new Point(32, 310), Size = new Size(590, 38), Font = new Font("Segoe UI", 9) };
            Controls.AddRange(new Control[] { title, subtitle, status, open, exit, data, note });
            tray = new NotifyIcon { Icon = Icon, Text = "Devkit", Visible = false };
            ContextMenuStrip menu = new ContextMenuStrip();
            menu.Items.Add("Mở Devkit", null, delegate { OpenBrowser(); });
            menu.Items.Add("Hiện cửa sổ", null, delegate { Restore(); });
            menu.Items.Add("Dừng và thoát", null, delegate { RequestExit(); });
            tray.ContextMenuStrip = menu;
            tray.DoubleClick += delegate { Restore(); };
            Resize += delegate { if (WindowState == FormWindowState.Minimized) HideToTray(); };
            Shown += StartRuntime;
            FormClosing += StopRuntime;
        }

        private async void StartRuntime(object sender, EventArgs e)
        {
            try
            {
                await Task.Run(delegate { runtime.Start(); });
                ready = true;
                status.Text = "Ứng dụng đã sẵn sàng.\n" + runtime.Url;
                open.Enabled = true;
                OpenBrowser();
                healthTimer = new System.Windows.Forms.Timer { Interval = 2000 };
                healthTimer.Tick += delegate
                {
                    if (runtime.Server == null || runtime.Server.HasExited)
                    {
                        ready = false;
                        open.Enabled = false;
                        status.Text = "Devkit đã dừng. Hãy đóng và mở lại ứng dụng.\nChi tiết nằm trong launcher.log.";
                        healthTimer.Stop();
                    }
                };
                healthTimer.Start();
            }
            catch (Exception error)
            {
                runtime.Dispose();
                status.Text = "Chưa mở được Devkit. Hãy xem thông báo bên dưới.";
                MessageBox.Show(this, error.Message, "Devkit", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            finally { starting = false; }
        }

        private void OpenBrowser()
        {
            if (!ready) return;
            try { Runtime.OpenUrl(runtime.Url); }
            catch (Exception error) { MessageBox.Show(this, "Hãy mở " + runtime.Url + " trong trình duyệt.\n" + error.Message, "Devkit"); }
        }

        private void HideToTray() { tray.Visible = true; Hide(); }

        private void RequestExit() { exitRequested = true; Close(); }

        private void Restore() { Show(); WindowState = FormWindowState.Normal; Activate(); tray.Visible = false; }

        private void StopRuntime(object sender, FormClosingEventArgs e)
        {
            if (e.CloseReason == CloseReason.UserClosing && !exitRequested)
            { e.Cancel = true; HideToTray(); return; }
            if (starting) { exitRequested = false; e.Cancel = true; status.Text = "Đang khởi động. Bạn có thể thoát sau khi quá trình này hoàn tất."; return; }
            if (ready && runtime.RunningJob()
                && MessageBox.Show(this, "Một tác vụ đang chạy. Dừng ứng dụng sẽ hủy tác vụ đó. Bạn có muốn thoát?",
                    "Devkit", MessageBoxButtons.YesNo, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2) != DialogResult.Yes)
            { exitRequested = false; e.Cancel = true; return; }
            if (healthTimer != null) healthTimer.Stop();
            tray.Visible = false;
            tray.Dispose();
            runtime.Dispose();
        }
    }

    internal static class Program
    {
        [STAThread]
        private static int Main(string[] args)
        {
            bool smoke = Array.IndexOf(args, "--smoke-test") >= 0;
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            try
            {
                using (Runtime runtime = new Runtime())
                {
                    string key;
                    using (SHA256 hash = SHA256.Create())
                        key = BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(runtime.Home.ToLowerInvariant()))).Replace("-", "").Substring(0, 20);
                    bool first;
                    using (Mutex mutex = new Mutex(true, "Local\\Devkit.Desktop." + key, out first))
                    {
                        if (!first)
                        {
                            if (!smoke && !runtime.OpenExisting()) MessageBox.Show("Devkit đang khởi động. Bạn chờ một chút rồi mở lại nhé.", "Devkit");
                            return smoke ? 2 : 0;
                        }
                        try
                        {
                            if (smoke) runtime.SmokeTest();
                            else Application.Run(new MainWindow(runtime));
                        }
                        finally { mutex.ReleaseMutex(); }
                    }
                }
                return 0;
            }
            catch (Exception error)
            {
                if (smoke) Console.Error.WriteLine(error.ToString());
                else MessageBox.Show(error.Message, "Không mở được Devkit", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
        }
    }
}
