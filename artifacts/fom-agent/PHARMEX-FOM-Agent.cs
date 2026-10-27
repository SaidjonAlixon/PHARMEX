// PHARMEX FOM Agent — Windows EXE (IFOR PHARMA)
// Compile: csc /nologo /target:winexe /out:PHARMEX-FOM-Agent.exe /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Web.Extensions.dll PHARMEX-FOM-Agent.cs
using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace PharmexFomAgent
{
    static class Program
    {
        [STAThread]
        static void Main()
        {
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
                Text = "Apteka kompyuterida ishlaydi: REPORT.exe (8084) → PHARMEX sayti",
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
            Log("IFOR PHARMA · Agent tayyor. Avval REPORT.exe (8084) kerak.");
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
                    "[CLOUD]\r\nURL=https://pharmex-navy.vercel.app\r\nTOKEN=\r\n\r\n[FOM]\r\nREPORT_URL=http://127.0.0.1:8084\r\nFILIAL_IDS=1\r\nINITIAL_DAYS=90\r\nINTERVAL_MIN=5\r\nTIMEOUT_SEC=120\r\n",
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
                    Log("REPORT: " + cfg.ReportUrl);
                    SetStatus("Bulut tekshirilmoqda…", Color.DarkOrange);
                    PingCloud(cfg);
                    Log("Bulut OK.");
                    try
                    {
                        FetchReport(cfg, 189, cfg.FilialIds[0], DateTime.UtcNow.Date, DateTime.UtcNow.Date);
                        Log("REPORT.exe OK.");
                        SetStatus("Ulangan", Color.FromArgb(23, 154, 69));
                    }
                    catch (Exception ex)
                    {
                        Log(ex.Message);
                        SetStatus("REPORT.exe yo'q — kutilyapti", Color.Firebrick);
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
                throw new Exception("config.ini: [CLOUD] URL va TOKEN ni to'ldiring.");
            var filials = Regex.Split(get("FOM", "FILIAL_IDS"), @"[,;\s]+");
            var list = new List<string>();
            foreach (var f in filials) if (!string.IsNullOrWhiteSpace(f)) list.Add(f.Trim());
            if (list.Count == 0) list.Add("1");
            int n;
            return new Config
            {
                CloudUrl = url,
                Token = token,
                ReportUrl = string.IsNullOrWhiteSpace(get("FOM", "REPORT_URL")) ? "http://127.0.0.1:8084" : get("FOM", "REPORT_URL").TrimEnd('/'),
                FilialIds = list.ToArray(),
                InitialDays = int.TryParse(get("FOM", "INITIAL_DAYS"), out n) && n > 0 ? n : 90,
                IntervalMin = int.TryParse(get("FOM", "INTERVAL_MIN"), out n) ? Math.Max(0, n) : 5,
                TimeoutSec = int.TryParse(get("FOM", "TIMEOUT_SEC"), out n) && n > 0 ? n : 120
            };
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
                    throw new Exception("REPORT.exe topilmadi (" + cfg.ReportUrl + "). FOM texnigi 8084 ni ochishi kerak.");
                throw new Exception("REPORT.exe: " + ex.Message);
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
                        if (ex.Message.Contains("REPORT.exe topilmadi")) throw;
                    }
                }
            }
            return Tuple.Create(imported, errors);
        }

        int Push(Config cfg, JavaScriptSerializer ser, string report, string filial, string xml)
        {
            var payload = ser.Serialize(new Dictionary<string, object>
            {
                { "report", report },
                { "filialId", filial },
                { "xml", xml }
            });
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
