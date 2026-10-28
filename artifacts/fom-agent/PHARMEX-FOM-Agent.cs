// PHARMEX FOM Agent — Windows EXE (IFOR PHARMA)
// Compile: csc /nologo /target:winexe /out:PHARMEX-FOM-Agent.exe /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Web.Extensions.dll PHARMEX-FOM-Agent.cs
using System;
using System.Collections.Generic;
using System.Data;
using System.Data.SqlClient;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

namespace PharmexFomAgent
{
    static class Program
    {
        [STAThread]
        static void Main()
        {
            // .NET 4.0 defaults to old SSL; Vercel needs TLS 1.2
            try
            {
                ServicePointManager.Expect100Continue = true;
                ServicePointManager.SecurityProtocol =
                    (SecurityProtocolType)0x00000C00 | // Tls12
                    (SecurityProtocolType)0x00000300 | // Tls11
                    (SecurityProtocolType)0x000000C0;  // Tls
                ServicePointManager.ServerCertificateValidationCallback = delegate { return true; };
            }
            catch { }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new MainForm());
        }
    }

    sealed class MainForm : Form
    {
        readonly TextBox logBox;
        readonly Button startBtn;
        readonly Button onceBtn;
        readonly Label statusLbl;
        readonly NotifyIcon tray;
        volatile bool running;
        Thread worker;
        string sqlConnString;
        TcpListener bridgeListener;
        volatile bool bridgeRunning;

        static readonly Dictionary<string, ReportDef> Reports = new Dictionary<string, ReportDef>
        {
            { "organizations", new ReportDef(189, false, "Tashkilotlar") },
            { "catalog", new ReportDef(188, false, "Tovarlar") },
            { "stock", new ReportDef(6, false, "Qoldiqlar") },
            { "purchases", new ReportDef(11, true, "Kirim") },
            { "supplierReturns", new ReportDef(12, true, "Qaytarish") },
            { "writeOffs", new ReportDef(3, true, "Hisobdan chiqarish") },
            { "retailSales", new ReportDef(14, true, "Chakana savdo") },
            { "insuranceSales", new ReportDef(15, true, "Sugurta savdo") },
        };

        public MainForm()
        {
            Text = "PHARMEX FOM Agent — IFOR PHARMA";
            Width = 720;
            Height = 520;
            StartPosition = FormStartPosition.CenterScreen;
            Font = new Font("Segoe UI", 10f);
            BackColor = Color.FromArgb(248, 250, 252);

            var title = new Label
            {
                Text = "PHARMEX  ·  FOM Agent",
                Font = new Font("Segoe UI Semibold", 16f),
                AutoSize = true,
                Location = new Point(20, 16),
                ForeColor = Color.FromArgb(15, 48, 110)
            };
            var hint = new Label
            {
                Text = "Shu kompyuterdagi Fom_ID + CH ni o'zi topadi (ODJX marketplace emas)",
                AutoSize = true,
                Location = new Point(22, 50),
                ForeColor = Color.FromArgb(90, 100, 120)
            };
            statusLbl = new Label
            {
                Text = "Tayyor",
                AutoSize = true,
                Location = new Point(22, 78),
                ForeColor = Color.FromArgb(23, 154, 69)
            };
            startBtn = new Button
            {
                Text = "Ishga tushirish (avto)",
                Width = 180,
                Height = 36,
                Location = new Point(20, 110),
                BackColor = Color.FromArgb(15, 179, 199),
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat
            };
            onceBtn = new Button
            {
                Text = "Bir marta tortish",
                Width = 160,
                Height = 36,
                Location = new Point(210, 110),
                FlatStyle = FlatStyle.Flat
            };
            var openCfg = new Button
            {
                Text = "config.ini",
                Width = 110,
                Height = 36,
                Location = new Point(380, 110),
                FlatStyle = FlatStyle.Flat
            };
            logBox = new TextBox
            {
                Multiline = true,
                ScrollBars = ScrollBars.Vertical,
                ReadOnly = true,
                Location = new Point(20, 160),
                Width = 660,
                Height = 290,
                Anchor = AnchorStyles.Top | AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right,
                Font = new Font("Consolas", 9f),
                BackColor = Color.White
            };

            startBtn.Click += (s, e) => StartLoop(false);
            onceBtn.Click += (s, e) => StartLoop(true);
            openCfg.Click += (s, e) =>
            {
                EnsureConfig();
                System.Diagnostics.Process.Start("notepad.exe", ConfigPath());
            };

            Controls.Add(title);
            Controls.Add(hint);
            Controls.Add(statusLbl);
            Controls.Add(startBtn);
            Controls.Add(onceBtn);
            Controls.Add(openCfg);
            Controls.Add(logBox);

            tray = new NotifyIcon
            {
                Text = "PHARMEX FOM Agent",
                Visible = true,
                Icon = SystemIcons.Application
            };
            tray.DoubleClick += (s, e) => { Show(); WindowState = FormWindowState.Normal; };

            EnsureConfig();
            Log("config: " + ConfigPath());
            Log("Agent tayyor. Ishga tushganda shu kompyuterdagi FOM eshigini o'zi qidiradi.");
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (running && e.CloseReason == CloseReason.UserClosing)
            {
                e.Cancel = true;
                Hide();
                tray.ShowBalloonTip(2000, "PHARMEX", "Agent fon rejimida ishlayapti.", ToolTipIcon.Info);
                return;
            }
            tray.Visible = false;
            running = false;
            base.OnFormClosing(e);
        }

        string AppDir()
        {
            return AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\', '/');
        }

        string ConfigPath()
        {
            return Path.Combine(AppDir(), "config.ini");
        }

        string LogPath()
        {
            return Path.Combine(AppDir(), "agent.log");
        }

        void EnsureConfig()
        {
            var path = ConfigPath();
            if (File.Exists(path)) return;
            var example = Path.Combine(AppDir(), "config.example.ini");
            if (File.Exists(example)) File.Copy(example, path);
            else
            {
                File.WriteAllText(path,
                    "[CLOUD]\r\nURL=https://pharmex-navy.vercel.app\r\n; PHARMEX FOM_SITE_TOKEN (ODJX_ marketplace EMAS)\r\nTOKEN=\r\n\r\n[PHARMACY]\r\n; Bo'sh qoldiring — agent F-Apteka dan o'zi topadi\r\nFOM_ID=\r\nCH=\r\nNAME=\r\n\r\n[FOM]\r\nREPORT_URL=auto\r\nFILIAL_IDS=1\r\nINITIAL_DAYS=90\r\nINTERVAL_MIN=5\r\nTIMEOUT_SEC=120\r\n",
                    Encoding.UTF8);
            }
        }

        void Log(string message)
        {
            var line = "[" + DateTime.Now.ToString("HH:mm:ss") + "] " + message;
            Action append = delegate
            {
                logBox.AppendText(line + Environment.NewLine);
            };
            if (InvokeRequired) BeginInvoke(append); else append();
            try { File.AppendAllText(LogPath(), DateTime.Now.ToString("s") + " " + message + Environment.NewLine, Encoding.UTF8); } catch { }
        }

        void SetStatus(string text, Color color)
        {
            Action apply = delegate
            {
                statusLbl.Text = text;
                statusLbl.ForeColor = color;
            };
            if (InvokeRequired) BeginInvoke(apply); else apply();
        }

        void StartLoop(bool once)
        {
            if (running) return;
            running = true;
            startBtn.Enabled = false;
            onceBtn.Enabled = false;
            worker = new Thread(() =>
            {
                try
                {
                    var cfg = LoadConfig();
                    Log("Cloud: " + cfg.CloudUrl);
                    SetStatus("Bulut tekshirilmoqda…", Color.DarkOrange);
                    PingCloud(cfg);
                    Log("Bulut OK.");

                    SetStatus("Apteka identifikatori qidirilmoqda…", Color.DarkOrange);
                    ResolvePharmacyIdentity(cfg);
                    Log("Apteka: Fom_ID=" + (cfg.FomId ?? "?") + "  CH=" + (cfg.Ch ?? "?") +
                        (string.IsNullOrEmpty(cfg.PharmacyName) ? "" : ("  " + cfg.PharmacyName)));
                    if (!string.IsNullOrEmpty(cfg.FomId)) SaveIniValue("PHARMACY", "FOM_ID", cfg.FomId);
                    if (!string.IsNullOrEmpty(cfg.Ch)) SaveIniValue("PHARMACY", "CH", cfg.Ch);
                    if (!string.IsNullOrEmpty(cfg.PharmacyName)) SaveIniValue("PHARMACY", "NAME", cfg.PharmacyName);

                    SetStatus("FOM eshigi qidirilmoqda…", Color.DarkOrange);
                    try
                    {
                        cfg.ReportUrl = ResolveReportUrl(cfg);
                    }
                    catch (Exception ex)
                    {
                        Log(ex.Message);
                        Log("REPORT yo'q — o'zim bog'layman (avto-start + SQL bridge)…");
                        cfg.ReportUrl = EnsureLocalDataBridge(cfg);
                    }
                    Log("REPORT: " + cfg.ReportUrl);
                    SaveIniValue("FOM", "REPORT_URL", cfg.ReportUrl);
                    WritePharmexSiteIni(cfg);

                    try
                    {
                        FetchReport(cfg, 189, cfg.FilialIds[0], DateTime.UtcNow.Date, DateTime.UtcNow.Date);
                        Log("FOM eshigi OK: " + cfg.ReportUrl);
                        SetStatus(string.IsNullOrEmpty(cfg.FomId) ? "Ulangan" : ("Ulangan · Fom_ID " + cfg.FomId), Color.FromArgb(23, 154, 69));
                    }
                    catch (Exception ex)
                    {
                        Log(ex.Message);
                        SetStatus("FOM eshigi topilmadi — kutilyapti", Color.Firebrick);
                        if (once) return;
                    }

                    while (running)
                    {
                        try
                        {
                            FetchReport(cfg, 189, cfg.FilialIds[0], DateTime.UtcNow.Date, DateTime.UtcNow.Date);
                            SetStatus("Sinxronlanmoqda…", Color.DarkOrange);
                            var result = SyncOnce(cfg);
                            Log("Tayyor: " + result.Item1 + " yozuv, " + result.Item2 + " xato.");
                            SetStatus("Ulangan · oxirgi: " + DateTime.Now.ToString("HH:mm"), Color.FromArgb(23, 154, 69));
                            File.WriteAllText(Path.Combine(AppDir(), "last-ok.txt"), DateTime.Now.ToString("o"), Encoding.UTF8);
                        }
                        catch (Exception ex)
                        {
                            Log("Xato: " + ex.Message);
                            SetStatus(ex.Message.Contains("REPORT.exe") ? "REPORT.exe yo'q — kutilyapti" : "Xato", Color.Firebrick);
                        }
                        if (once || !running || cfg.IntervalMin <= 0) break;
                        for (int i = 0; i < cfg.IntervalMin * 60 && running; i++) Thread.Sleep(1000);
                    }
                }
                catch (Exception ex)
                {
                    Log("To'xtadi: " + ex.Message);
                    SetStatus("To'xtadi", Color.Firebrick);
                    MessageBox.Show(ex.Message, "PHARMEX Agent", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                }
                finally
                {
                    running = false;
                    BeginInvoke((Action)(() => { startBtn.Enabled = true; onceBtn.Enabled = true; }));
                }
            });
            worker.IsBackground = true;
            worker.Start();
        }

        sealed class ReportDef
        {
            public int Id; public bool Dated; public string Label;
            public ReportDef(int id, bool dated, string label) { Id = id; Dated = dated; Label = label; }
        }

        sealed class Config
        {
            public string CloudUrl;
            public string Token;
            public string ReportUrl;
            public string[] FilialIds;
            public int InitialDays;
            public int IntervalMin;
            public int TimeoutSec;
            /// <summary>Shu kompyuterdagi F-Apteka Fom_ID (masalan 16372). ODJX ro'yxatidagi 1-qator emas.</summary>
            public string FomId;
            /// <summary>Shu ulanishning CH kodi (masalan R5T5Q6H6E7T7Q).</summary>
            public string Ch;
            public string PharmacyName;
        }

        Config LoadConfig()
        {
            EnsureConfig();
            var map = ParseIni(File.ReadAllText(ConfigPath(), Encoding.UTF8));
            Func<string, string, string> get = delegate(string sec, string key)
            {
                Dictionary<string, string> s;
                string v;
                if (!map.TryGetValue(sec, out s) || !s.TryGetValue(key, out v)) return "";
                return v;
            };
            var url = get("CLOUD", "URL").TrimEnd('/');
            var token = get("CLOUD", "TOKEN");
            if (string.IsNullOrWhiteSpace(url) || string.IsNullOrWhiteSpace(token))
                throw new Exception("config.ini: [CLOUD] URL va TOKEN ni to'ldiring (PHARMEX FOM_SITE_TOKEN — ODJX emas).");
            if (token.StartsWith("ODJX_", StringComparison.OrdinalIgnoreCase))
                throw new Exception(
                    "ODJX_… — bu Fom_Connect marketplace tokeni (ro'yxatdan 1-aptekani oladi). " +
                    "PHARMEX uchun Vercel dagi FOM_SITE_TOKEN ni yozing. " +
                    "Shu aptekaning Fom_ID/CH ni agent o'zi topadi.");
            var filials = Regex.Split(get("FOM", "FILIAL_IDS"), @"[,;\s]+");
            var list = new List<string>();
            foreach (var f in filials) if (!string.IsNullOrWhiteSpace(f)) list.Add(f.Trim());
            if (list.Count == 0) list.Add("1");
            int n;
            return new Config
            {
                CloudUrl = url,
                Token = token,
                ReportUrl = string.IsNullOrWhiteSpace(get("FOM", "REPORT_URL")) ? "auto" : get("FOM", "REPORT_URL").TrimEnd('/'),
                FilialIds = list.ToArray(),
                InitialDays = int.TryParse(get("FOM", "INITIAL_DAYS"), out n) && n > 0 ? n : 90,
                IntervalMin = int.TryParse(get("FOM", "INTERVAL_MIN"), out n) ? Math.Max(0, n) : 5,
                TimeoutSec = int.TryParse(get("FOM", "TIMEOUT_SEC"), out n) && n > 0 ? n : 120,
                FomId = NullIfEmpty(get("PHARMACY", "FOM_ID")),
                Ch = NullIfEmpty(get("PHARMACY", "CH")),
                PharmacyName = NullIfEmpty(get("PHARMACY", "NAME"))
            };
        }

        static string NullIfEmpty(string s)
        {
            return string.IsNullOrWhiteSpace(s) ? null : s.Trim();
        }

        /// <summary>
        /// Har apteka kompyuterida o'z Fom_ID + CH bor (F-Apteka oynasidagi).
        /// ODJX tokenini tashlasang marketplace 1-qatorga yopishib qoladi — shuning uchun
        /// identifikatorni shu PC dagi FAPTEKA sozlamalaridan o'qiymiz.
        /// </summary>
        void ResolvePharmacyIdentity(Config cfg)
        {
            if (!string.IsNullOrEmpty(cfg.FomId) && !string.IsNullOrEmpty(cfg.Ch))
            {
                Log("config.ini dagi apteka identifikatori ishlatiladi.");
                return;
            }
            Log("FAPTEKA dan Fom_ID / CH qidiruv…");
            string[] roots = {
                @"C:\FAPTEKA", @"D:\FAPTEKA", @"E:\FAPTEKA",
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "FAPTEKA"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "FAPTEKA"),
                AppDir()
            };
            string[] names = {
                "SETUP.ini", "SETUP", "NAPTEKA", "NGLOBAL", "CONFIG", "config.ini",
                "SITE.ini", "CONNECT.ini", "Fom_Connect.ini", "GLOBAL.ini", "NGLOBAL.ini"
            };
            foreach (var root in roots)
            {
                if (!Directory.Exists(root)) continue;
                foreach (var name in names)
                {
                    try
                    {
                        foreach (var file in Directory.GetFiles(root, name, SearchOption.TopDirectoryOnly))
                            ExtractPharmacyFromFile(file, cfg);
                    }
                    catch { }
                }
                try
                {
                    foreach (var file in Directory.GetFiles(root, "SETUP.ini", SearchOption.AllDirectories))
                    {
                        ExtractPharmacyFromFile(file, cfg);
                        if (!string.IsNullOrEmpty(cfg.FomId) && !string.IsNullOrEmpty(cfg.Ch)) break;
                    }
                }
                catch { }
                if (!string.IsNullOrEmpty(cfg.FomId) && !string.IsNullOrEmpty(cfg.Ch)) break;
            }

            // Registry (ba'zi o'rnatishlar)
            try
            {
                using (var key = Registry.CurrentUser.OpenSubKey(@"Software\FAPTEKA"))
                {
                    if (key != null)
                    {
                        if (string.IsNullOrEmpty(cfg.FomId))
                            cfg.FomId = NullIfEmpty(Convert.ToString(key.GetValue("Fom_ID") ?? key.GetValue("FomId") ?? key.GetValue("FOM_ID")));
                        if (string.IsNullOrEmpty(cfg.Ch))
                            cfg.Ch = NullIfEmpty(Convert.ToString(key.GetValue("CH") ?? key.GetValue("Channel")));
                    }
                }
            }
            catch { }

            if (string.IsNullOrEmpty(cfg.FomId) && string.IsNullOrEmpty(cfg.Ch))
                Log("Ogohlantirish: Fom_ID/CH topilmadi — config.ini [PHARMACY] ga qo'lda yozing (F-Apteka oynasidagi).");
        }

        void ExtractPharmacyFromFile(string file, Config cfg)
        {
            string text;
            try { text = File.ReadAllText(file, Encoding.Default); }
            catch { return; }

            if (string.IsNullOrEmpty(cfg.FomId))
            {
                var m = Regex.Match(text, @"(?im)^\s*(?:Fom[_\s]?[Ii][Dd]|FOM_ID|FomId)\s*[=:]\s*(\d{3,8})\s*$");
                if (m.Success) { cfg.FomId = m.Groups[1].Value; Log("  Fom_ID=" + cfg.FomId + " ← " + file); }
            }
            if (string.IsNullOrEmpty(cfg.Ch))
            {
                // CH=R5T5Q6H6E7T7Q — ODJX_ va uzun marketplace tokenlardan farq qiladi
                var m = Regex.Match(text, @"(?im)^\s*(?:CH|Channel|CHANNEL)\s*[=:]\s*([A-Z0-9]{8,20})\s*$");
                if (m.Success && !m.Groups[1].Value.StartsWith("ODJX", StringComparison.OrdinalIgnoreCase))
                {
                    cfg.Ch = m.Groups[1].Value;
                    Log("  CH=" + cfg.Ch + " ← " + file);
                }
            }
            if (string.IsNullOrEmpty(cfg.PharmacyName))
            {
                var m = Regex.Match(text, @"(?im)^\s*(?:NAME|Наименование|Apteka|PHARMACY|ORG)\s*[=:]\s*(.+)\s*$");
                if (m.Success)
                {
                    var n = m.Groups[1].Value.Trim();
                    if (n.Length >= 3 && n.Length < 120 && n.IndexOf("http", StringComparison.OrdinalIgnoreCase) < 0)
                        cfg.PharmacyName = n;
                }
            }
        }

        void SaveIniValue(string section, string key, string value)
        {
            try
            {
                var path = ConfigPath();
                EnsureConfig();
                var lines = new List<string>(File.ReadAllLines(path, Encoding.UTF8));
                string cur = "";
                bool replaced = false;
                for (int i = 0; i < lines.Count; i++)
                {
                    var t = lines[i].Trim();
                    var sm = Regex.Match(t, @"^\[(.+)\]$");
                    if (sm.Success) { cur = sm.Groups[1].Value.ToUpperInvariant(); continue; }
                    if (cur == section.ToUpperInvariant() && t.StartsWith(key + "=", StringComparison.OrdinalIgnoreCase))
                    {
                        lines[i] = key + "=" + value;
                        replaced = true;
                        break;
                    }
                }
                if (!replaced)
                {
                    lines.Add("[" + section + "]");
                    lines.Add(key + "=" + value);
                }
                File.WriteAllLines(path, lines.ToArray(), Encoding.UTF8);
            }
            catch { }
        }

        /// <summary>
        /// Har aptekada REPORT.exe porti har xil bo'lishi mumkin.
        /// Faqat lokal manzillar (soliq.uz va boshqa internet URL lar emas).
        /// </summary>
        string ResolveReportUrl(Config cfg)
        {
            var candidates = new List<string>();
            Action<string> add = delegate(string u)
            {
                if (string.IsNullOrWhiteSpace(u)) return;
                u = u.Trim().TrimEnd('/');
                if (!u.StartsWith("http", StringComparison.OrdinalIgnoreCase)) u = "http://" + u;
                if (!IsLocalReportCandidate(u)) return;
                if (!candidates.Contains(u)) candidates.Add(u);
            };

            if (!string.IsNullOrWhiteSpace(cfg.ReportUrl) &&
                !cfg.ReportUrl.Equals("auto", StringComparison.OrdinalIgnoreCase))
                add(cfg.ReportUrl);

            foreach (var u in ReadUrlsFromFaptekaConfigs()) add(u);
            foreach (var p in ListenPortsFromFomProcesses()) add("http://127.0.0.1:" + p);
            LogReportBinaries();

            // Eng ko'p uchraydigan portlar (FOM hujjatidagi 8084 birinchilardan)
            int[] ports = { 8084, 8080, 8085, 8081, 8082, 8083, 8090, 8888, 9000, 14786, 80 };
            foreach (var p in ports) add("http://127.0.0.1:" + p);

            Log("Qidiruv: " + candidates.Count + " ta lokal manzil…");
            foreach (var url in candidates)
            {
                Log("  tekshiruv: " + url);
                if (ProbeReportUrl(url, cfg.FilialIds[0]))
                {
                    Log("  topildi: " + url);
                    return url;
                }
            }
            throw new Exception(
                "NServis/F-APTEKA bor, lekin REPORT.exe (SERVICEREPORTS) HTTP eshigi yo'q. " +
                "FOM texnikiga: SERVICEREPORTS ni o'rnating (odatda 8084). " +
                "Yoki config.ini da REPORT_URL=http://127.0.0.1:PORT yozing.");
        }

        static bool IsLocalReportCandidate(string url)
        {
            try
            {
                var uri = new Uri(url);
                var host = (uri.Host ?? "").ToLowerInvariant();
                if (host == "localhost" || host == "127.0.0.1" || host == "::1") return true;
                // ichki tarmoq
                if (Regex.IsMatch(host, @"^192\.168\.\d+\.\d+$")) return true;
                if (Regex.IsMatch(host, @"^10\.\d+\.\d+\.\d+$")) return true;
                if (Regex.IsMatch(host, @"^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$")) return true;
                return false;
            }
            catch { return false; }
        }

        List<int> ListenPortsFromFomProcesses()
        {
            var ports = new List<int>();
            var pids = new List<int>();
            try
            {
                foreach (var p in Process.GetProcesses())
                {
                    string n = "";
                    try { n = p.ProcessName; } catch { continue; }
                    if (!Regex.IsMatch(n, "REPORT|SERVICEREPORT|NServis|FOM_SQL|SITE", RegexOptions.IgnoreCase))
                        continue;
                    Log("Jarayon topildi: " + n + " (PID " + p.Id + ")");
                    pids.Add(p.Id);
                }
            }
            catch { }
            if (pids.Count == 0) return ports;

            // netstat -ano orqali shu PID lar tinglayotgan portlar
            try
            {
                var psi = new ProcessStartInfo
                {
                    FileName = "netstat.exe",
                    Arguments = "-ano",
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    CreateNoWindow = true
                };
                using (var proc = Process.Start(psi))
                {
                    string output = proc.StandardOutput.ReadToEnd();
                    proc.WaitForExit(5000);
                    foreach (Match m in Regex.Matches(output,
                        @"TCP\s+(\d+\.\d+\.\d+\.\d+|\[::\]|\[::1\]):(\d+)\s+\S+\s+LISTENING\s+(\d+)",
                        RegexOptions.IgnoreCase))
                    {
                        int pid, port;
                        if (!int.TryParse(m.Groups[3].Value, out pid) || !pids.Contains(pid)) continue;
                        if (!int.TryParse(m.Groups[2].Value, out port) || port < 1) continue;
                        if (!ports.Contains(port))
                        {
                            ports.Add(port);
                            Log("  jarayon porti: " + port + " (PID " + pid + ")");
                        }
                    }
                }
            }
            catch { }
            return ports;
        }

        void LogReportBinaries()
        {
            string[] roots = { @"C:\FAPTEKA", @"D:\FAPTEKA", @"E:\FAPTEKA" };
            string[] names = { "REPORT.exe", "SERVICEREPORTS.exe", "ServiceReports.exe", "NREPORT.exe" };
            foreach (var root in roots)
            {
                if (!Directory.Exists(root)) continue;
                foreach (var name in names)
                {
                    try
                    {
                        foreach (var f in Directory.GetFiles(root, name, SearchOption.AllDirectories))
                            Log("Topildi fayl: " + f);
                    }
                    catch { }
                }
            }
        }

        List<string> ReadUrlsFromFaptekaConfigs()
        {
            var found = new List<string>();
            string[] roots = {
                @"C:\FAPTEKA", @"D:\FAPTEKA", @"E:\FAPTEKA",
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "FAPTEKA"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "FAPTEKA"),
                AppDir()
            };
            string[] names = { "SETUP.ini", "SETUP", "NAPTEKA", "NGLOBAL", "CONFIG", "config.ini", "REPORT.ini", "SERVICEREPORTS.ini" };
            foreach (var root in roots)
            {
                if (!Directory.Exists(root)) continue;
                Log("FAPTEKA papka: " + root);
                foreach (var name in names)
                {
                    try
                    {
                        foreach (var file in Directory.GetFiles(root, name, SearchOption.TopDirectoryOnly))
                            ExtractUrlsFromFile(file, found);
                    }
                    catch { }
                }
                try
                {
                    foreach (var file in Directory.GetFiles(root, "SETUP.ini", SearchOption.AllDirectories))
                    {
                        ExtractUrlsFromFile(file, found);
                        if (found.Count > 40) break;
                    }
                }
                catch { }
            }
            return found;
        }

        void ExtractUrlsFromFile(string file, List<string> found)
        {
            string text;
            try { text = File.ReadAllText(file, Encoding.Default); }
            catch { return; }
            foreach (Match m in Regex.Matches(text, @"https?://[^\s""'<>]+", RegexOptions.IgnoreCase))
            {
                var u = m.Value.TrimEnd('/', '\\', ',', ';');
                if (!found.Contains(u)) found.Add(u);
            }
            // PORT=8084 yoki pPort=8084 / REPORT_PORT=
            foreach (Match m in Regex.Matches(text, @"(?i)(?:REPORT_)?PORT\s*=\s*(\d{2,5})"))
            {
                var u = "http://127.0.0.1:" + m.Groups[1].Value;
                if (!found.Contains(u)) found.Add(u);
            }
            foreach (Match m in Regex.Matches(text, @"(?im)^\s*URL\s*=\s*(.+)\s*$"))
            {
                var v = m.Groups[1].Value.Trim();
                if (v.Length == 0 || v.IndexOf("pharmex", StringComparison.OrdinalIgnoreCase) >= 0) continue;
                if (!v.StartsWith("http", StringComparison.OrdinalIgnoreCase))
                {
                    if (Regex.IsMatch(v, @"^\d+\.\d+\.\d+\.\d+(:\d+)?")) v = "http://" + v;
                    else if (Regex.IsMatch(v, @"^[\w\.-]+:\d+$")) v = "http://" + v;
                    else continue;
                }
                if (!found.Contains(v)) found.Add(v);
            }
        }

        /// <summary>
        /// REPORT.exe bo'lmasa: 1) REPORT faylini ishga tushirish 2) SQL (NAPTSKLAD) dan lokal HTTP bridge.
        /// </summary>
        string EnsureLocalDataBridge(Config cfg)
        {
            if (TryStartReportExecutables())
            {
                Thread.Sleep(4000);
                try
                {
                    var url = ResolveReportUrl(cfg);
                    Log("REPORT.exe ishga tushdi: " + url);
                    return url;
                }
                catch (Exception ex) { Log("REPORT start dan keyin ham yo'q: " + ex.Message); }
            }

            // NServis portlarida chuqur qidiruv
            TryDeepProbeNservis(cfg);

            LogFaptekaDataFiles();
            sqlConnString = DiscoverSqlConnection();
            if (string.IsNullOrEmpty(sqlConnString))
                throw new Exception(
                    "Haqiqiy FOM ma'lumot bazasi topilmadi. " +
                    "CMD: dir /s C:\\FAPTEKA\\*.mdf  va  agent.log ni yuboring. " +
                    "Yoki FOM texnikidan SERVICEREPORTS (REPORT.exe) so'rang.");

            Log("SQL ulanish OK — lokal hisobot eshigini ochaman…");
            int port = StartSqlReportBridge(cfg);
            var bridgeUrl = "http://127.0.0.1:" + port;
            try
            {
                var xml = HttpGet(bridgeUrl + "/P_GetReport_XML?pDateFrom=01.01.2020&pDateTo=31.12.2030&pFilial_id=1&pReport_id=188", 30);
                int vCount = Regex.Matches(xml ?? "", @"<\s*V\b", RegexOptions.IgnoreCase).Count;
                Log("Bridge sinov (catalog): " + vCount + " qator");
                if (vCount == 0)
                    Log("Ogohlantirish: katalog bo'sh — baza hali to'liq emas yoki noto'g'ri tanlangan.");
            }
            catch (Exception ex) { Log("Bridge sinov: " + ex.Message); }
            Log("Lokal bridge: " + bridgeUrl + " (SQL → PHARMEX)");
            return bridgeUrl;
        }

        void TryDeepProbeNservis(Config cfg)
        {
            var ports = ListenPortsFromFomProcesses();
            if (ports.Count == 0) ports.AddRange(new[] { 28887, 8084, 14786 });
            string[] paths = {
                "/P_GetReport_XML?pDateFrom=01.01.2020&pDateTo=31.12.2030&pFilial_id=1&pReport_id=189",
                "/P_GetReport_XML?pDateFrom=01.01.2020&pDateTo=31.12.2030&pFilial_id=1&pReport_id=188",
                "/P_GetReport_XML?pDateFrom=01.01.2020&pDateTo=31.12.2030&pFilial_id=1&pReport_id=6",
                "/report", "/Report", "/api", "/xml", "/", "/SERVICEREPORTS", "/Service"
            };
            foreach (var p in ports)
            {
                foreach (var path in paths)
                {
                    var url = "http://127.0.0.1:" + p + path;
                    try
                    {
                        var body = HttpGet(url, 3);
                        if (string.IsNullOrEmpty(body)) continue;
                        var sample = Path.Combine(AppDir(), "nservice-" + p + ".txt");
                        File.WriteAllText(sample, body.Length > 4000 ? body.Substring(0, 4000) : body, Encoding.UTF8);
                        if (body.IndexOf("<V", StringComparison.OrdinalIgnoreCase) >= 0 ||
                            Regex.IsMatch(body, @"<\s*V\b", RegexOptions.IgnoreCase))
                        {
                            Log("NServis REPORT topildi: " + url);
                            // config ga yozib qo'yamiz
                            SaveIniValue("FOM", "REPORT_URL", "http://127.0.0.1:" + p);
                        }
                        else
                            Log("NServis javob (" + p + path + "): " + body.Length + " bayt → " + sample);
                    }
                    catch { }
                }
            }
        }

        bool TryStartReportExecutables()
        {
            string[] roots = { @"C:\FAPTEKA", @"D:\FAPTEKA", @"E:\FAPTEKA" };
            string[] names = {
                "REPORT.exe", "SERVICEREPORTS.exe", "ServiceReports.exe", "NREPORT.exe", "ReportService.exe",
                "SITE.exe", "Fom_Site.exe", "FOMSITE.exe"
            };
            bool started = false;
            foreach (var root in roots)
            {
                if (!Directory.Exists(root)) continue;
                foreach (var name in names)
                {
                    try
                    {
                        foreach (var f in Directory.GetFiles(root, name, SearchOption.AllDirectories))
                        {
                            Log("Ishga tushirish: " + f);
                            try
                            {
                                var psi = new ProcessStartInfo(f) { WorkingDirectory = Path.GetDirectoryName(f), UseShellExecute = true };
                                Process.Start(psi);
                                started = true;
                            }
                            catch (Exception ex) { Log("  start xato: " + ex.Message); }
                        }
                    }
                    catch { }
                }
            }
            return started;
        }

        void WritePharmexSiteIni(Config cfg)
        {
            // SITE.exe topilsa PHARMEX manzilini yozib qo'yamiz — FOM o'zi ham yuborishi mumkin
            try
            {
                string[] roots = { @"C:\FAPTEKA", @"D:\FAPTEKA", @"E:\FAPTEKA" };
                var block = string.Format(
                    "\r\n; --- PHARMEX agent yozgan ---\r\n[SERVER]\r\nURL={0}/api/fom/site/{1}\r\nTOCING={1}\r\nTOKEN={1}\r\n",
                    cfg.CloudUrl.TrimEnd('/'), cfg.Token);
                foreach (var root in roots)
                {
                    if (!Directory.Exists(root)) continue;
                    var path = Path.Combine(root, "PHARMEX-SITE.ini");
                    File.WriteAllText(path, block, Encoding.UTF8);
                    Log("SITE sozlama: " + path);
                }
            }
            catch (Exception ex) { Log("SITE.ini: " + ex.Message); }
        }

        static bool IsJunkTable(string name)
        {
            if (string.IsNullOrEmpty(name)) return true;
            var u = name.ToUpperInvariant();
            if (u == "DTPROPERTIES" || u == "SYSDIAGRAMS") return true;
            if (u.StartsWith("DT_") || u.StartsWith("SYS") || u.StartsWith("MSPEER") || u.StartsWith("MSREPL") || u.StartsWith("MSMERGE")) return true;
            return false;
        }

        void LogFaptekaDataFiles()
        {
            string[] roots = { @"C:\FAPTEKA", @"D:\FAPTEKA", @"E:\FAPTEKA" };
            string[] patterns = { "*.mdf", "*.ldf", "*.fdb", "*.gdb", "*.db", "*.mdb", "*.accdb", "NAPTEKA*", "NAPT*" };
            foreach (var root in roots)
            {
                if (!Directory.Exists(root)) continue;
                Log("FAPTEKA fayllar: " + root);
                foreach (var pat in patterns)
                {
                    try
                    {
                        foreach (var f in Directory.GetFiles(root, pat, SearchOption.AllDirectories))
                        {
                            try
                            {
                                var fi = new FileInfo(f);
                                Log("  " + f + " (" + (fi.Length / 1024) + " KB)");
                            }
                            catch { Log("  " + f); }
                        }
                    }
                    catch { }
                }
            }
        }

        int ScoreDatabase(SqlConnection conn)
        {
            // Foydali (apteka) jadvallar soni — dtproperties emas
            try
            {
                int score = 0;
                using (var cmd = new SqlCommand(@"
SELECT t.name, SUM(CASE WHEN p.index_id IN (0,1) THEN p.rows ELSE 0 END)
FROM sys.tables t
JOIN sys.partitions p ON p.object_id=t.object_id
GROUP BY t.name", conn))
                using (var r = cmd.ExecuteReader())
                {
                    while (r.Read())
                    {
                        var name = r.GetString(0);
                        if (IsJunkTable(name)) continue;
                        long rows = r.IsDBNull(1) ? 0 : Convert.ToInt64(r.GetValue(1));
                        score += 2;
                        if (rows > 0) score += 5;
                        if (rows > 100) score += 10;
                        var u = name.ToUpperInvariant();
                        if (NameAny(u, "TOVAR", "OST", "PRODAJ", "PRIHOD", "SALE", "STOCK", "CHEK", "DOC", "NAPT", "GOOD", "SKLAD", "POSTAV", "REALIZ"))
                            score += 20;
                    }
                }
                return score;
            }
            catch
            {
                try
                {
                    int n = 0;
                    using (var cmd = new SqlCommand("SELECT name FROM sys.tables", conn))
                    using (var r = cmd.ExecuteReader())
                        while (r.Read()) if (!IsJunkTable(r.GetString(0))) n++;
                    return n;
                }
                catch { return 0; }
            }
        }

        List<string> ListSqlInstances()
        {
            var list = new List<string>();
            Action<string> add = delegate(string s)
            {
                if (!string.IsNullOrWhiteSpace(s) && !list.Contains(s)) list.Add(s.Trim());
            };
            add("localhost"); add("."); add("(local)");
            add(@".\SQLEXPRESS"); add(@"localhost\SQLEXPRESS");
            add(@"(localdb)\MSSQLLocalDB"); add(@"127.0.0.1"); add(@"127.0.0.1\SQLEXPRESS");
            try
            {
                using (var k = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Microsoft SQL Server\Instance Names\SQL"))
                {
                    if (k != null)
                        foreach (var name in k.GetValueNames())
                        {
                            if (string.Equals(name, "MSSQLSERVER", StringComparison.OrdinalIgnoreCase))
                                add("localhost");
                            else
                            {
                                add(@".\" + name);
                                add(@"localhost\" + name);
                            }
                        }
                }
            }
            catch { }
            try
            {
                using (var k = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\WOW6432Node\Microsoft\Microsoft SQL Server\Instance Names\SQL"))
                {
                    if (k != null)
                        foreach (var name in k.GetValueNames())
                        {
                            if (string.Equals(name, "MSSQLSERVER", StringComparison.OrdinalIgnoreCase)) add("localhost");
                            else { add(@".\" + name); add(@"localhost\" + name); }
                        }
                }
            }
            catch { }
            return list;
        }

        List<string> FindAllMdfFiles()
        {
            var files = new List<string>();
            var roots = new List<string> { @"C:\FAPTEKA", @"D:\FAPTEKA", @"E:\FAPTEKA", @"C:\Program Files\Microsoft SQL Server", @"C:\Program Files (x86)\Microsoft SQL Server" };
            // SQL default DATA folders
            try
            {
                foreach (var d in Directory.GetDirectories(@"C:\Program Files\Microsoft SQL Server", "MSSQL*", SearchOption.TopDirectoryOnly))
                {
                    var data = Path.Combine(d, "MSSQL", "DATA");
                    if (Directory.Exists(data)) roots.Add(data);
                }
            }
            catch { }
            foreach (var root in roots)
            {
                if (!Directory.Exists(root)) continue;
                try
                {
                    foreach (var f in Directory.GetFiles(root, "*.mdf", SearchOption.AllDirectories))
                    {
                        var name = Path.GetFileNameWithoutExtension(f).ToUpperInvariant();
                        if (name.StartsWith("MASTER") || name.StartsWith("TEMP") || name.StartsWith("MODEL") || name.StartsWith("MSDB")) continue;
                        if (!files.Contains(f)) files.Add(f);
                        Log("MDF: " + f + " (" + (new FileInfo(f).Length / 1024 / 1024) + " MB)");
                    }
                }
                catch { }
            }
            return files;
        }

        void TryAttachMdfFiles(SqlConnection master, List<string> mdfs)
        {
            foreach (var mdf in mdfs)
            {
                try
                {
                    var dbName = "PX_" + Path.GetFileNameWithoutExtension(mdf);
                    dbName = Regex.Replace(dbName, @"[^\w]", "_");
                    // allaqachon ulanganmi?
                    using (var check = new SqlCommand("SELECT DB_ID(@n)", master))
                    {
                        check.Parameters.AddWithValue("@n", dbName);
                        var id = check.ExecuteScalar();
                        if (id != null && id != DBNull.Value) { Log("MDF allaqachon ulangan: " + dbName); continue; }
                    }
                    var ldf = Path.ChangeExtension(mdf, ".ldf");
                    string sql;
                    if (File.Exists(ldf))
                        sql = "CREATE DATABASE [" + dbName + "] ON (FILENAME=N'" + mdf.Replace("'", "''") + "'), (FILENAME=N'" + ldf.Replace("'", "''") + "') FOR ATTACH";
                    else
                        sql = "CREATE DATABASE [" + dbName + "] ON (FILENAME=N'" + mdf.Replace("'", "''") + "') FOR ATTACH_REBUILD_LOG";
                    Log("MDF ulash: " + dbName + " ← " + mdf);
                    using (var cmd = new SqlCommand(sql, master)) { cmd.CommandTimeout = 120; cmd.ExecuteNonQuery(); }
                    Log("MDF OK: " + dbName);
                }
                catch (Exception ex) { Log("MDF ulanmadi: " + Path.GetFileName(mdf) + " — " + ex.Message); }
            }
        }

        string DiscoverSqlConnection()
        {
            string preferredServer = null;
            string preferredDb = "NAPTSKLAD";
            var hintedDbs = new List<string>();
            string[] roots = { @"C:\FAPTEKA", @"D:\FAPTEKA", @"E:\FAPTEKA", AppDir() };
            foreach (var root in roots)
            {
                if (!Directory.Exists(root)) continue;
                try
                {
                    foreach (var file in Directory.GetFiles(root, "*.ini", SearchOption.AllDirectories))
                    {
                        string text;
                        try { text = File.ReadAllText(file, Encoding.Default); } catch { continue; }
                        var ms = Regex.Match(text, @"(?im)^\s*(?:SERVER|Data\s*Source|DATA[_\s]?SOURCE)\s*=\s*(.+)\s*$");
                        var mb = Regex.Match(text, @"(?im)^\s*(?:BASE|DATABASE|Initial\s*Catalog|DB|CATALOG)\s*=\s*(.+)\s*$");
                        if (ms.Success) { preferredServer = ms.Groups[1].Value.Trim(); Log("SQL SETUP server: " + preferredServer + " ← " + file); }
                        if (mb.Success)
                        {
                            preferredDb = mb.Groups[1].Value.Trim();
                            if (!hintedDbs.Contains(preferredDb)) hintedDbs.Add(preferredDb);
                            Log("SQL SETUP baza: " + preferredDb + " ← " + file);
                        }
                    }
                }
                catch { }
            }
            foreach (var d in new[] { preferredDb, "NAPTSKLAD", "NAPTEKA", "NAPT", "FAPTEKA", "FOM", "APTEKA" })
                if (!string.IsNullOrEmpty(d) && !hintedDbs.Contains(d)) hintedDbs.Add(d);

            var serverList = ListSqlInstances();
            if (!string.IsNullOrEmpty(preferredServer)) serverList.Insert(0, preferredServer);
            var mdfs = FindAllMdfFiles();

            string bestCs = null;
            int bestScore = -1;
            string bestLabel = "";

            foreach (var srv in serverList)
            {
                string[] masterCs = {
                    "Data Source=" + srv + ";Initial Catalog=master;Integrated Security=True;Connect Timeout=4",
                    "Data Source=" + srv + ";Initial Catalog=master;User ID=sa;Password=;Connect Timeout=4",
                    "Data Source=" + srv + ";Initial Catalog=master;User ID=sa;Password=sa;Connect Timeout=4"
                };
                foreach (var mcs in masterCs)
                {
                    try
                    {
                        using (var master = new SqlConnection(mcs))
                        {
                            master.Open();
                            Log("SQL server: " + srv);
                            // Avval MDF larni ulab ko'ramiz
                            if (mdfs.Count > 0) TryAttachMdfFiles(master, mdfs);

                            var dbs = new List<string>();
                            using (var cmd = new SqlCommand(
                                "SELECT name FROM sys.databases WHERE state_desc='ONLINE' AND name NOT IN ('master','tempdb','model','msdb') ORDER BY name", master))
                            using (var r = cmd.ExecuteReader())
                                while (r.Read()) dbs.Add(r.GetString(0));
                            Log("SQL bazalar: " + string.Join(", ", dbs.ToArray()));
                            foreach (var hint in hintedDbs)
                                if (!dbs.Contains(hint)) dbs.Insert(0, hint);

                            bool winAuth = mcs.IndexOf("Integrated Security=True", StringComparison.OrdinalIgnoreCase) >= 0;
                            foreach (var db in dbs)
                            {
                                string cs = winAuth
                                    ? ("Data Source=" + srv + ";Initial Catalog=" + db + ";Integrated Security=True;Connect Timeout=5")
                                    : mcs.Replace("Initial Catalog=master", "Initial Catalog=" + db);
                                try
                                {
                                    using (var conn = new SqlConnection(cs))
                                    {
                                        conn.Open();
                                        int score = ScoreDatabase(conn);
                                        Log("  baza " + db + " ball=" + score);
                                        if (score > bestScore)
                                        {
                                            bestScore = score;
                                            bestCs = cs;
                                            bestLabel = srv + " / " + db;
                                        }
                                    }
                                }
                                catch { }
                            }
                        }
                        break;
                    }
                    catch { }
                }
            }

            if (bestCs != null && bestScore > 0)
            {
                Log("Eng yaxshi SQL: " + bestLabel + " (ball " + bestScore + ")");
                sqlSchema = null;
                return bestCs;
            }

            Log("Ogohlantirish: foydali SQL baza topilmadi (ball=" + bestScore + ").");
            return null;
        }

        int StartSqlReportBridge(Config cfg)
        {
            if (bridgeRunning && bridgeListener != null) return ((IPEndPoint)bridgeListener.LocalEndpoint).Port;
            int[] tryPorts = { 18784, 18785, 18786, 8084 };
            Exception last = null;
            foreach (var port in tryPorts)
            {
                try
                {
                    var listener = new TcpListener(IPAddress.Loopback, port);
                    listener.Start();
                    bridgeListener = listener;
                    bridgeRunning = true;
                    var t = new Thread(() => BridgeLoop(cfg, listener));
                    t.IsBackground = true;
                    t.Start();
                    Log("SQL bridge port: " + port);
                    return port;
                }
                catch (Exception ex) { last = ex; }
            }
            throw new Exception("Bridge port ochilmadi: " + (last != null ? last.Message : ""));
        }

        void BridgeLoop(Config cfg, TcpListener listener)
        {
            while (running || bridgeRunning)
            {
                try
                {
                    if (!listener.Pending()) { Thread.Sleep(40); continue; }
                    var client = listener.AcceptTcpClient();
                    ThreadPool.QueueUserWorkItem(delegate { HandleBridgeClient(client, cfg); });
                }
                catch { if (!bridgeRunning) break; Thread.Sleep(100); }
            }
        }

        void HandleBridgeClient(TcpClient client, Config cfg)
        {
            try
            {
                using (client)
                using (var stream = client.GetStream())
                {
                    stream.ReadTimeout = 8000;
                    stream.WriteTimeout = 30000;
                    var buf = new byte[8192];
                    int n = stream.Read(buf, 0, buf.Length);
                    if (n <= 0) return;
                    var req = Encoding.ASCII.GetString(buf, 0, n);
                    var first = req.Split('\n')[0];
                    var qm = Regex.Match(first, @"P_GetReport_XML\?([^\s]+)", RegexOptions.IgnoreCase);
                    string xml;
                    if (!qm.Success)
                        xml = "<R/>";
                    else
                    {
                        var qs = qm.Groups[1].Value;
                        Func<string, string> get = delegate(string key)
                        {
                            var m = Regex.Match(qs, key + @"=([^&]*)", RegexOptions.IgnoreCase);
                            return m.Success ? Uri.UnescapeDataString(m.Groups[1].Value.Replace('+', ' ')) : "";
                        };
                        int reportId;
                        int.TryParse(get("pReport_id"), out reportId);
                        var filial = get("pFilial_id");
                        if (string.IsNullOrEmpty(filial)) filial = cfg.FilialIds[0];
                        var from = ParseFomDateOrToday(get("pDateFrom"));
                        var to = ParseFomDateOrToday(get("pDateTo"));
                        xml = BuildReportXmlFromSql(reportId, filial, from, to, cfg);
                    }
                    var body = Encoding.UTF8.GetBytes(xml);
                    var header = "HTTP/1.1 200 OK\r\nContent-Type: text/xml; charset=utf-8\r\nContent-Length: " +
                                 body.Length + "\r\nConnection: close\r\n\r\n";
                    var hb = Encoding.ASCII.GetBytes(header);
                    stream.Write(hb, 0, hb.Length);
                    stream.Write(body, 0, body.Length);
                }
            }
            catch (Exception ex)
            {
                try { Log("bridge: " + ex.Message); } catch { }
            }
        }

        static DateTime ParseFomDateOrToday(string s)
        {
            var m = Regex.Match(s ?? "", @"^(\d{2})\.(\d{2})\.(\d{4})$");
            if (m.Success)
                return new DateTime(int.Parse(m.Groups[3].Value), int.Parse(m.Groups[2].Value), int.Parse(m.Groups[1].Value));
            return DateTime.UtcNow.Date;
        }

        // Jadval → ustunlar keshi (bir marta to'ldiriladi)
        Dictionary<string, List<string>> sqlSchema;
        List<string> sqlTableOrder;

        string BuildReportXmlFromSql(int reportId, string filial, DateTime from, DateTime to, Config cfg)
        {
            if (string.IsNullOrEmpty(sqlConnString)) return "<R/>";
            try
            {
                using (var conn = new SqlConnection(sqlConnString))
                {
                    conn.Open();
                    EnsureSqlSchema(conn);
                    var spXml = TryExecFomReportProc(conn, reportId, filial, from, to);
                    if (!string.IsNullOrEmpty(spXml) && spXml.IndexOf("<V", StringComparison.OrdinalIgnoreCase) >= 0) return spXml;

                    switch (reportId)
                    {
                        case 189: return XmlFromOrg(conn, cfg);
                        case 188: return PullTablesXml(conn, ScoreTables("catalog"), null, null, 8000);
                        case 6: return PullTablesXml(conn, ScoreTables("stock"), null, null, 30000);
                        case 14:
                        case 15: return PullTablesXml(conn, ScoreTables("sales"), from, to, 30000);
                        case 11: return PullTablesXml(conn, ScoreTables("purchases"), from, to, 30000);
                        case 12: return PullTablesXml(conn, ScoreTables("returns"), from, to, 20000);
                        case 3: return PullTablesXml(conn, ScoreTables("writeoffs"), from, to, 20000);
                        default: return "<R/>";
                    }
                }
            }
            catch (Exception ex)
            {
                Log("SQL report " + reportId + ": " + ex.Message);
                return "<R/>";
            }
        }

        void EnsureSqlSchema(SqlConnection conn)
        {
            if (sqlSchema != null) return;
            sqlSchema = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);
            sqlTableOrder = new List<string>();
            var counts = new Dictionary<string, long>(StringComparer.OrdinalIgnoreCase);
            try
            {
                using (var cmd = new SqlCommand(@"
SELECT t.name, SUM(CASE WHEN p.index_id IN (0,1) THEN p.rows ELSE 0 END) AS rowcnt
FROM sys.tables t
JOIN sys.partitions p ON p.object_id=t.object_id
GROUP BY t.name
ORDER BY rowcnt DESC", conn))
                using (var r = cmd.ExecuteReader())
                    while (r.Read())
                    {
                        var name = r.GetString(0);
                        var n = r.IsDBNull(1) ? 0 : Convert.ToInt64(r.GetValue(1));
                        counts[name] = n;
                        sqlTableOrder.Add(name);
                    }
            }
            catch
            {
                using (var cmd = new SqlCommand("SELECT name FROM sys.tables", conn))
                using (var r = cmd.ExecuteReader())
                    while (r.Read()) sqlTableOrder.Add(r.GetString(0));
            }

            // tizim/junk jadvallarni olib tashlash
            sqlTableOrder.RemoveAll(IsJunkTable);

            foreach (var t in sqlTableOrder)
            {
                try
                {
                    var cols = new List<string>();
                    using (var cmd = new SqlCommand(
                        "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME=@t ORDER BY ORDINAL_POSITION", conn))
                    {
                        cmd.Parameters.AddWithValue("@t", t);
                        using (var r = cmd.ExecuteReader())
                            while (r.Read()) cols.Add(r.GetString(0));
                    }
                    sqlSchema[t] = cols;
                }
                catch { }
            }
            if (sqlTableOrder.Count == 0)
                Log("Ogohlantirish: bu bazada foydali jadval yo'q — boshqa SQL bazani qidirish kerak.");

            // diskka yozamiz — keyin tuzatish oson
            try
            {
                var dump = new StringBuilder();
                foreach (var t in sqlTableOrder)
                {
                    long n = counts.ContainsKey(t) ? counts[t] : -1;
                    dump.AppendLine(t + "\trows=" + n + "\tcols=" +
                        (sqlSchema.ContainsKey(t) ? string.Join(",", sqlSchema[t].ToArray()) : ""));
                }
                File.WriteAllText(Path.Combine(AppDir(), "fapteka-schema.txt"), dump.ToString(), Encoding.UTF8);
                Log("Sxema: fapteka-schema.txt (" + sqlTableOrder.Count + " jadval)");
            }
            catch { }
        }

        /// <summary>Hisobot turiga mos jadvallarni ball bilan tartiblaydi.</summary>
        List<string> ScoreTables(string kind)
        {
            var scored = new List<KeyValuePair<int, string>>();
            foreach (var t in sqlTableOrder)
            {
                if (!sqlSchema.ContainsKey(t)) continue;
                var cols = sqlSchema[t];
                var cu = new List<string>();
                foreach (var c in cols) cu.Add(c.ToUpperInvariant());
                string tu = t.ToUpperInvariant();
                int score = 0;

                bool hasId = ColAny(cu, "ID", "KOD", "CODE", "TOVAR", "PRODUCT", "GOOD");
                bool hasName = ColAny(cu, "NAME", "NAIM", "NAZV", "NAIMEN");
                bool hasQty = ColAny(cu, "KOL", "QTY", "QUANT", "OSTAT", "AMOUNT", "KOLICH");
                bool hasDate = ColAny(cu, "DATE", "DATA", "DAT", "SOLD", "PERIOD", "DT", "TIME");
                bool hasPrice = ColAny(cu, "CENA", "PRICE", "SUMMA", "SUM", "COST");

                if (kind == "catalog")
                {
                    if (hasName) score += 5;
                    if (hasId) score += 3;
                    if (NameAny(tu, "TOVAR", "PRODUCT", "GOOD", "NOMEN", "SPR", "MEDIC", "PREPAR", "ARTIKUL")) score += 8;
                    if (NameAny(tu, "OST", "SALE", "DOC", "MOVE", "LOG", "HIST")) score -= 5;
                }
                else if (kind == "stock")
                {
                    if (hasQty) score += 6;
                    if (hasId) score += 2;
                    if (NameAny(tu, "OST", "STOCK", "REST", "BALANC", "SKLAD", "QOLDIQ", "OSTAT")) score += 10;
                    if (NameAny(tu, "SALE", "PRODAJ", "CHEK", "DOC")) score -= 3;
                }
                else if (kind == "sales")
                {
                    if (hasDate) score += 4;
                    if (hasQty || hasPrice) score += 4;
                    if (NameAny(tu, "PRODAJ", "SALE", "RETAIL", "REALIZ", "CHEK", "CHECK", "KASSA", "CHEQUE", "RECEIPT")) score += 10;
                    if (NameAny(tu, "SPEC", "STROK", "LINE", "POS", "ITEM", "DETAL", "CONTENT")) score += 4;
                    if (NameAny(tu, "OST", "SPR", "DICT")) score -= 4;
                }
                else if (kind == "purchases")
                {
                    if (hasDate) score += 3;
                    if (hasQty || hasPrice) score += 3;
                    if (NameAny(tu, "PRIHOD", "PURCH", "POSTAV", "KIRIM", "INCOME", "PRIH", "SUPPLY", "NAKLAD")) score += 10;
                    if (NameAny(tu, "SPEC", "STROK", "LINE", "POS", "ITEM", "DETAL")) score += 4;
                }
                else if (kind == "returns")
                {
                    if (NameAny(tu, "VOZVRAT", "RETURN", "QAYTAR", "RETUR")) score += 10;
                    if (hasDate) score += 2;
                }
                else if (kind == "writeoffs")
                {
                    if (NameAny(tu, "SPISAN", "WRITE", "HISOBDAN", "BRACK", "UTILIZ", "LOSS")) score += 10;
                    if (hasDate) score += 2;
                }

                // bo'sh jadvallarni pastga
                if (score > 0) scored.Add(new KeyValuePair<int, string>(score, t));
            }
            scored.Sort((a, b) => b.Key.CompareTo(a.Key));
            var list = new List<string>();
            foreach (var kv in scored)
            {
                if (kv.Key < 3) continue;
                list.Add(kv.Value);
                if (list.Count >= 6) break;
            }
            // hech narsa topilmasa — eng katta jadvallardan urinish
            if (list.Count == 0)
            {
                foreach (var t in sqlTableOrder)
                {
                    list.Add(t);
                    if (list.Count >= 4) break;
                }
            }
            return list;
        }

        static bool ColAny(List<string> colsUpper, params string[] hints)
        {
            foreach (var c in colsUpper)
                foreach (var h in hints)
                    if (c.IndexOf(h, StringComparison.OrdinalIgnoreCase) >= 0) return true;
            return false;
        }

        static bool NameAny(string tableUpper, params string[] hints)
        {
            foreach (var h in hints)
                if (tableUpper.IndexOf(h, StringComparison.OrdinalIgnoreCase) >= 0) return true;
            return false;
        }

        string PullTablesXml(SqlConnection conn, List<string> tables, DateTime? from, DateTime? to, int limit)
        {
            var sb = new StringBuilder("<R>");
            int got = 0;
            foreach (var t in tables)
            {
                try
                {
                    Log("SQL → " + t + (from.HasValue ? (" " + FomDate(from.Value) + "–" + FomDate(to ?? from.Value)) : ""));
                    var cols = sqlSchema.ContainsKey(t) ? sqlSchema[t] : null;
                    string sql = "SELECT TOP " + limit + " * FROM [" + t.Replace("]", "]]") + "]";
                    // sana filtri bo'lsa
                    if (from.HasValue && cols != null)
                    {
                        string dateCol = null;
                        foreach (var c in cols)
                        {
                            var u = c.ToUpperInvariant();
                            if (u.Contains("DATE") || u.Contains("DATA") || u == "DAT" || u.EndsWith("_DT") || u.Contains("SOLD") || u == "DT")
                            { dateCol = c; break; }
                        }
                        if (dateCol != null)
                        {
                            sql = "SELECT TOP " + limit + " * FROM [" + t.Replace("]", "]]") + "] WHERE [" +
                                  dateCol.Replace("]", "]]") + "] >= @from AND [" + dateCol.Replace("]", "]]") + "] < @toPlus";
                        }
                    }
                    using (var cmd = new SqlCommand(sql, conn))
                    {
                        if (sql.Contains("@from"))
                        {
                            cmd.Parameters.AddWithValue("@from", from.Value);
                            cmd.Parameters.AddWithValue("@toPlus", (to ?? from.Value).AddDays(1));
                        }
                        using (var r = cmd.ExecuteReader())
                        {
                            var xml = ReaderToFomXml(r);
                            var inner = Regex.Replace(xml, @"^<R>|</R>$", "");
                            if (inner.Length > 0)
                            {
                                sb.Append(inner);
                                got++;
                                // birinchi muvaffaqiyatli jadval yetarli (catalog/stock); sales uchun ham birinchi
                                if (got >= 1) break;
                            }
                        }
                    }
                }
                catch (Exception ex) { Log("  " + t + ": " + ex.Message); }
            }
            sb.Append("</R>");
            return sb.ToString();
        }

        string TryExecFomReportProc(SqlConnection conn, int reportId, string filial, DateTime from, DateTime to)
        {
            string[] procs = {
                "P_GetReport_XML", "dbo.P_GetReport_XML", "GetReport_XML", "GetReportXML",
                "sp_GetReport_XML", "REPORT_XML", "p_report_xml"
            };
            foreach (var proc in procs)
            {
                try
                {
                    using (var cmd = new SqlCommand(proc, conn))
                    {
                        cmd.CommandType = CommandType.StoredProcedure;
                        cmd.CommandTimeout = 60;
                        cmd.Parameters.AddWithValue("@pDateFrom", from);
                        cmd.Parameters.AddWithValue("@pDateTo", to);
                        cmd.Parameters.AddWithValue("@pFilial_id", filial);
                        cmd.Parameters.AddWithValue("@pReport_id", reportId);
                        using (var r = cmd.ExecuteReader())
                        {
                            var xml = ReaderToFomXml(r);
                            if (!string.IsNullOrEmpty(xml) && xml != "<R></R>" && xml != "<R/>")
                            {
                                Log("SP OK: " + proc);
                                return xml;
                            }
                        }
                    }
                }
                catch { }
            }
            return null;
        }

        string XmlFromOrg(SqlConnection conn, Config cfg)
        {
            var sb = new StringBuilder("<R>");
            var id = string.IsNullOrEmpty(cfg.FomId) ? "1" : cfg.FomId;
            var name = string.IsNullOrEmpty(cfg.PharmacyName) ? ("Filial " + id) : cfg.PharmacyName;
            sb.AppendFormat("<V I=\"{0}\" N=\"{1}\" APT=\"1\" />", Esc(id), Esc(name));
            var extra = PullTablesXml(conn, ScoreTables("catalog").FindAll(t => NameAny(t.ToUpperInvariant(), "ORG", "FILIAL", "BRANCH", "APTEKA", "CONTR", "PARTNER", "FIRMA", "POSTAV")), null, null, 500);
            sb.Append(Regex.Replace(extra, @"^<R>|</R>$", ""));
            sb.Append("</R>");
            return sb.ToString();
        }

        string ReaderToFomXml(IDataReader r)
        {
            if (r.FieldCount == 0) return "<R/>";
            var names = new string[r.FieldCount];
            for (int i = 0; i < r.FieldCount; i++) names[i] = r.GetName(i);
            var map = new string[r.FieldCount];
            for (int i = 0; i < r.FieldCount; i++) map[i] = MapColToFomAttr(names[i], i, names);

            var sb = new StringBuilder("<R>");
            int rows = 0;
            while (r.Read())
            {
                if (r.FieldCount == 1 && !r.IsDBNull(0))
                {
                    var one = Convert.ToString(r.GetValue(0));
                    if (!string.IsNullOrEmpty(one) && one.IndexOf('<') >= 0)
                        return one.Trim().StartsWith("<R", StringComparison.OrdinalIgnoreCase) ? one : ("<R>" + one + "</R>");
                }
                var attrs = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                for (int i = 0; i < r.FieldCount; i++)
                {
                    if (r.IsDBNull(i)) continue;
                    var attr = map[i];
                    if (string.IsNullOrEmpty(attr) || attrs.ContainsKey(attr)) continue;
                    var val = Convert.ToString(r.GetValue(i));
                    if (val == null) continue;
                    if (r.GetFieldType(i) == typeof(DateTime))
                    {
                        try { val = ((DateTime)r.GetValue(i)).ToString("dd.MM.yyyy"); }
                        catch { }
                    }
                    attrs[attr] = val;
                }
                // PHARMEX importi uchun: qatorlarda G (tovar) va Q (miqdor) kerak
                if (!attrs.ContainsKey("G") && attrs.ContainsKey("I")) attrs["G"] = attrs["I"];
                if (!attrs.ContainsKey("Q") && attrs.ContainsKey("K")) attrs["Q"] = attrs["K"];
                if (!attrs.ContainsKey("ID") && attrs.ContainsKey("N") && attrs.ContainsKey("D"))
                    attrs["ID"] = attrs["N"] + "|" + attrs["D"];
                if (attrs.Count == 0) continue;
                sb.Append("<V");
                foreach (var kv in attrs)
                    sb.Append(" ").Append(kv.Key).Append("=\"").Append(Esc(kv.Value)).Append("\"");
                sb.Append(" />");
                rows++;
                if (rows >= 50000) break;
            }
            sb.Append("</R>");
            return sb.ToString();
        }

        static string MapColToFomAttr(string col, int index, string[] all)
        {
            var c = (col ?? "").ToUpperInvariant();
            // tovar kodi — G (savdo/qoldiq importi shuni kutadi)
            if (c == "G" || c.Contains("TOVAR") || c.Contains("PRODUCT") || c.Contains("GOODS") || c == "ARTIKUL" || c == "SKU")
                return "G";
            if (c == "IDDOC" || c == "DOCID" || c == "DOC_ID" || c == "CHECKID" || c == "CHEKID" || c == "SALEID" || c.Contains("DOCUMENT"))
                return "ID";
            if (c == "I" || c == "KOD" || c == "CODE" || (c == "ID" && index == 0)) return "I";
            if (c.EndsWith("_ID") && (c.Contains("TOVAR") || c.Contains("PRODUCT") || c.Contains("GOOD"))) return "G";
            if (c.EndsWith("_ID") && (c.Contains("DOC") || c.Contains("CHEK") || c.Contains("SALE"))) return "ID";
            if (c == "N" || c == "NAME" || c == "NAIM" || c == "NAZVANIE" || c == "NAIMENOVANIE" || c.Contains("NAME") || c.Contains("NAIM")) return "N";
            if (c == "NOM" || c == "NOMER" || c == "DOCNO" || c == "NUM" || c == "NUMBER" || c == "CHECKNO" || c == "CHEKNO") return "N";
            if (c == "Q" || c == "KOL" || c == "QTY" || c == "QUANTITY" || c == "OSTATOK" || c == "KOLICHESTVO" || c.Contains("KOL")) return "Q";
            if (c == "K" || c == "AMOUNT") return "K";
            if (c == "D" || c == "DATE" || c == "DATA" || c == "DAT" || c.Contains("DATE") || c.EndsWith("_DT") || c == "SOLDAT" || c == "DT") return "D";
            if (c == "P" || c == "PRICE" || c == "CENA" || c == "PRICE_RET" || c.Contains("PRICE") || c.Contains("CENA") || c.Contains("ROZN")) return "P";
            if (c == "SP" || c == "SUMMA" || c == "SUM" || c == "TOTAL" || c == "AMOUNT_SUM") return "SP";
            if (c == "SN" || c == "NDS" || c == "VAT" || c == "QQS") return "SN";
            if (c == "E" || c == "ED" || c == "UNIT" || c == "EI" || c.Contains("UNIT") || c == "EXPIRY" || c == "SROK" || c.Contains("GODN")) return "E";
            if (c == "O" || c == "FILIAL" || c == "BRANCH" || c == "SKLAD" || c.Contains("FILIAL")) return "O";
            if (c == "F") return "F";
            if (c == "INN" || c == "APT" || c == "INC" || c == "INV" || c == "DIS" || c == "INS" || c == "IK" || c == "UN" || c == "UP" || c == "R" || c == "C" || c == "PN" || c == "PD" || c == "NI" || c == "CI")
                return c.Length <= 2 ? c : c.Substring(0, Math.Min(2, c.Length));
            if (c.Length <= 2 && Regex.IsMatch(c, @"^[A-Z]+$")) return c;
            return null;
        }

        static string Esc(string s)
        {
            if (string.IsNullOrEmpty(s)) return "";
            return s.Replace("&", "&amp;").Replace("\"", "&quot;").Replace("<", "&lt;").Replace(">", "&gt;");
        }

        bool ProbeReportUrl(string baseUrl, string filial)
        {
            // Avval port ochiqmi
            try
            {
                var uri = new Uri(baseUrl);
                var host = string.IsNullOrEmpty(uri.Host) ? "127.0.0.1" : uri.Host;
                var port = uri.Port > 0 ? uri.Port : 80;
                using (var c = new TcpClient())
                {
                    var ar = c.BeginConnect(host, port, null, null);
                    if (!ar.AsyncWaitHandle.WaitOne(700)) return false;
                    c.EndConnect(ar);
                }
            }
            catch { return false; }

            // REPORT.exe imzosi: P_GetReport_XML va haqiqiy FOM XML (HTML 404 emas)
            try
            {
                var today = DateTime.UtcNow.Date;
                var url = string.Format("{0}/P_GetReport_XML?pDateFrom={1}&pDateTo={2}&pFilial_id={3}&pReport_id=189",
                    baseUrl.TrimEnd('/'), FomDate(today), FomDate(today), string.IsNullOrEmpty(filial) ? "1" : filial);
                var req = (HttpWebRequest)WebRequest.Create(url);
                req.Method = "GET";
                req.Timeout = 4000;
                req.ReadWriteTimeout = 4000;
                using (var res = (HttpWebResponse)req.GetResponse())
                {
                    if ((int)res.StatusCode < 200 || (int)res.StatusCode >= 300) return false;
                    using (var sr = new StreamReader(res.GetResponseStream(), Encoding.UTF8))
                    {
                        var body = sr.ReadToEnd();
                        if (string.IsNullOrEmpty(body) || body.IndexOf('<') < 0) return false;
                        // Oddiy HTML sahifa emas — FOM qatorlari (V yoki atributli yozuvlar)
                        if (Regex.IsMatch(body, @"<\s*html\b", RegexOptions.IgnoreCase)) return false;
                        return Regex.IsMatch(body, @"<\s*V\b", RegexOptions.IgnoreCase)
                            || body.IndexOf("P_GetReport", StringComparison.OrdinalIgnoreCase) >= 0
                            || Regex.IsMatch(body, @"\bI\s*=\s*""", RegexOptions.IgnoreCase);
                    }
                }
            }
            catch { return false; }
        }

        static Dictionary<string, Dictionary<string, string>> ParseIni(string text)
        {
            var map = new Dictionary<string, Dictionary<string, string>>(StringComparer.OrdinalIgnoreCase);
            string section = "";
            foreach (var raw in text.Split(new[] { "\r\n", "\n" }, StringSplitOptions.None))
            {
                var line = raw.Trim();
                if (line.Length == 0 || line.StartsWith(";") || line.StartsWith("#")) continue;
                var sm = Regex.Match(line, @"^\[(.+)\]$");
                if (sm.Success) { section = sm.Groups[1].Value.ToUpperInvariant(); if (!map.ContainsKey(section)) map[section] = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase); continue; }
                var eq = line.IndexOf('=');
                if (eq < 1 || section.Length == 0) continue;
                map[section][line.Substring(0, eq).Trim()] = line.Substring(eq + 1).Trim();
            }
            return map;
        }

        static string FomDate(DateTime d)
        {
            return d.ToUniversalTime().ToString("dd.MM.yyyy");
        }

        string HttpGet(string url, int timeoutSec)
        {
            var req = (HttpWebRequest)WebRequest.Create(url);
            req.Method = "GET";
            req.Timeout = timeoutSec * 1000;
            req.ReadWriteTimeout = timeoutSec * 1000;
            using (var res = (HttpWebResponse)req.GetResponse())
            using (var sr = new StreamReader(res.GetResponseStream(), Encoding.UTF8))
                return sr.ReadToEnd();
        }

        string HttpPostJson(string url, string json, string token, int timeoutSec)
        {
            var bytes = Encoding.UTF8.GetBytes(json);
            var req = (HttpWebRequest)WebRequest.Create(url);
            req.Method = "POST";
            req.ContentType = "application/json; charset=utf-8";
            req.Headers["X-Token"] = token;
            req.Timeout = timeoutSec * 1000;
            req.ReadWriteTimeout = timeoutSec * 1000;
            req.ContentLength = bytes.Length;
            using (var s = req.GetRequestStream()) s.Write(bytes, 0, bytes.Length);
            using (var res = (HttpWebResponse)req.GetResponse())
            using (var sr = new StreamReader(res.GetResponseStream(), Encoding.UTF8))
                return sr.ReadToEnd();
        }

        void PingCloud(Config cfg)
        {
            var url = cfg.CloudUrl + "/api/fom/agent/" + Uri.EscapeDataString(cfg.Token) + "/ping";
            var req = (HttpWebRequest)WebRequest.Create(url);
            req.Method = "GET";
            req.Headers["X-Token"] = cfg.Token;
            req.Timeout = 30000;
            using (var res = (HttpWebResponse)req.GetResponse())
            using (var sr = new StreamReader(res.GetResponseStream(), Encoding.UTF8))
            {
                var body = sr.ReadToEnd();
                if (res.StatusCode != HttpStatusCode.OK) throw new Exception("PHARMEX: " + body);
            }
        }

        string FetchReport(Config cfg, int reportId, string filial, DateTime from, DateTime to)
        {
            var url = string.Format("{0}/P_GetReport_XML?pDateFrom={1}&pDateTo={2}&pFilial_id={3}&pReport_id={4}",
                cfg.ReportUrl, FomDate(from), FomDate(to), filial, reportId);
            try
            {
                var xml = HttpGet(url, cfg.TimeoutSec);
                if (xml.IndexOf('<') < 0) throw new Exception("REPORT.exe XML emas.");
                return xml;
            }
            catch (WebException ex)
            {
                if (ex.Status == WebExceptionStatus.ConnectFailure || ex.Status == WebExceptionStatus.NameResolutionFailure)
                    throw new Exception("FOM eshigiga ulanib bo'lmadi (" + cfg.ReportUrl + ").");
                throw new Exception("FOM eshigi: " + ex.Message);
            }
        }

        Tuple<int, int> SyncOnce(Config cfg)
        {
            var to = DateTime.UtcNow.Date;
            var from = to.AddDays(-cfg.InitialDays);
            int imported = 0, errors = 0;
            var ser = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };

            foreach (var kv in Reports)
            {
                var key = kv.Key;
                var def = kv.Value;
                foreach (var filial in cfg.FilialIds)
                {
                    try
                    {
                        if (!def.Dated)
                        {
                            Log("→ " + def.Label + " (filial " + filial + ")…");
                            var xml = FetchReport(cfg, def.Id, filial, to, to);
                            var result = Push(cfg, ser, key, filial, xml);
                            imported += result;
                        }
                        else
                        {
                            for (var cursor = from; cursor <= to; cursor = cursor.AddDays(31))
                            {
                                var end = cursor.AddDays(30);
                                if (end > to) end = to;
                                Log("→ " + def.Label + " (" + FomDate(cursor) + "–" + FomDate(end) + ")…");
                                var xml = FetchReport(cfg, def.Id, filial, cursor, end);
                                imported += Push(cfg, ser, key, filial, xml);
                            }
                        }
                    }
                    catch (Exception ex)
                    {
                        errors++;
                        Log("  ✗ " + ex.Message);
                        if (ex.Message.IndexOf("eshig", StringComparison.OrdinalIgnoreCase) >= 0) throw;
                    }
                }
            }
            return Tuple.Create(imported, errors);
        }

        int Push(Config cfg, JavaScriptSerializer ser, string report, string filial, string xml)
        {
            var payloadMap = new Dictionary<string, object>
            {
                { "report", report },
                { "filialId", filial },
                { "xml", xml }
            };
            if (!string.IsNullOrEmpty(cfg.FomId)) payloadMap["fomId"] = cfg.FomId;
            if (!string.IsNullOrEmpty(cfg.Ch)) payloadMap["ch"] = cfg.Ch;
            if (!string.IsNullOrEmpty(cfg.PharmacyName)) payloadMap["pharmacyName"] = cfg.PharmacyName;
            var payload = ser.Serialize(payloadMap);
            var url = cfg.CloudUrl + "/api/fom/agent/" + Uri.EscapeDataString(cfg.Token) + "/report";
            try
            {
                var body = HttpPostJson(url, payload, cfg.Token, Math.Max(cfg.TimeoutSec, 180));
                var dict = ser.DeserializeObject(body) as Dictionary<string, object>;
                int rows = 0, imp = 0;
                if (dict != null)
                {
                    if (dict.ContainsKey("rows")) rows = Convert.ToInt32(dict["rows"]);
                    if (dict.ContainsKey("imported")) imp = Convert.ToInt32(dict["imported"]);
                }
                Log("  ✓ " + rows + " qator → " + imp + " import");
                if (imp == 0 && rows > 0 && dict != null && dict.ContainsKey("sampleKeys"))
                    Log("  (maydonlar: " + Convert.ToString(dict["sampleKeys"]) + ")");
                if (imp == 0 && rows > 0)
                {
                    try
                    {
                        var samplePath = Path.Combine(AppDir(), "last-sample-" + report + ".xml");
                        File.WriteAllText(samplePath, xml.Length > 8000 ? xml.Substring(0, 8000) : xml, Encoding.UTF8);
                        Log("  namuna: " + samplePath);
                    }
                    catch { }
                }
                return imp;
            }
            catch (WebException ex)
            {
                string detail = ex.Message;
                if (ex.Response != null)
                {
                    using (var sr = new StreamReader(ex.Response.GetResponseStream()))
                        detail = sr.ReadToEnd();
                }
                throw new Exception("PHARMEX: " + detail);
            }
        }
    }
}
