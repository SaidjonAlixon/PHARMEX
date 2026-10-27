// PHARMEX FOM Agent — Windows EXE (IFOR PHARMA)
// Compile: csc /nologo /target:winexe /out:PHARMEX-FOM-Agent.exe /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Web.Extensions.dll PHARMEX-FOM-Agent.cs
using System;
using System.Collections.Generic;
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
                    cfg.ReportUrl = ResolveReportUrl(cfg);
                    Log("REPORT: " + cfg.ReportUrl);
                    SaveIniValue("FOM", "REPORT_URL", cfg.ReportUrl);

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
        /// config.ini, FAPTEKA sozlamalari va lokal portlarni tekshirib topadi.
        /// </summary>
        string ResolveReportUrl(Config cfg)
        {
            var candidates = new List<string>();
            Action<string> add = delegate(string u)
            {
                if (string.IsNullOrWhiteSpace(u)) return;
                u = u.Trim().TrimEnd('/');
                if (!u.StartsWith("http", StringComparison.OrdinalIgnoreCase)) u = "http://" + u;
                if (!candidates.Contains(u)) candidates.Add(u);
            };

            if (!string.IsNullOrWhiteSpace(cfg.ReportUrl) &&
                !cfg.ReportUrl.Equals("auto", StringComparison.OrdinalIgnoreCase))
                add(cfg.ReportUrl);

            foreach (var u in ReadUrlsFromFaptekaConfigs()) add(u);

            // Eng ko'p uchraydigan portlar (FOM hujjatidagi 8084 birinchilardan)
            int[] ports = { 8084, 8080, 8085, 8081, 8082, 8083, 8090, 8888, 9000, 80 };
            foreach (var p in ports) add("http://127.0.0.1:" + p);

            Log("Qidiruv: " + candidates.Count + " ta mumkin bo'lgan manzil…");
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
                "Shu kompyuterda FOM hisobot eshigi (REPORT.exe / SERVICEREPORTS) topilmadi. " +
                "FOM texnigi o'rnatishi yoki config.ini da REPORT_URL ni yozishi kerak.");
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
                // ham SETUP.ini ni ichki papkalarda qidirish (chuqurlik cheklangan)
                try
                {
                    foreach (var file in Directory.GetFiles(root, "SETUP.ini", SearchOption.AllDirectories))
                    {
                        ExtractUrlsFromFile(file, found);
                        if (found.Count > 20) break;
                    }
                }
                catch { }
            }

            // Ishlayotgan jarayonlar — faqat log uchun
            try
            {
                foreach (var p in Process.GetProcesses())
                {
                    string n = "";
                    try { n = p.ProcessName; } catch { continue; }
                    if (Regex.IsMatch(n, "REPORT|SERVICEREPORT|NServis|FOM_SQL", RegexOptions.IgnoreCase))
                        Log("Jarayon topildi: " + n + " (PID " + p.Id + ")");
                }
            }
            catch { }

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
            // PORT=8084 yoki pPort=8084
            foreach (Match m in Regex.Matches(text, @"(?i)(?:REPORT_)?PORT\s*=\s*(\d{2,5})"))
            {
                var u = "http://127.0.0.1:" + m.Groups[1].Value;
                if (!found.Contains(u)) found.Add(u);
            }
            // URL=... without scheme
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
