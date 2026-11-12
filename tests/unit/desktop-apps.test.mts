import { test } from "node:test";
import assert from "node:assert/strict";
import { blockedApp, findApp } from "../../lib/desktop-apps-core.ts";

const P = "C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\";
const apps = [
  { name: "Google Chrome", path: `${P}Google Chrome.lnk`, target: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" },
  { name: "Excel", path: `${P}Excel.lnk`, target: "C:\\Program Files\\Microsoft Office\\root\\Office16\\EXCEL.EXE" },
  { name: "Word", path: `${P}Word.lnk`, target: "C:\\Program Files\\Microsoft Office\\root\\Office16\\WINWORD.EXE" },
  { name: "Visual Studio Code", path: `${P}Visual Studio Code.lnk`, target: "C:\\Users\\m\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe" },
  { name: "Visual Studio 2022", path: `${P}Visual Studio 2022.lnk`, target: "C:\\Program Files\\Microsoft Visual Studio\\devenv.exe" },
  { name: "Windows PowerShell", path: `${P}Windows PowerShell.lnk`, target: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" },
  { name: "Command Prompt", path: `${P}Command Prompt.lnk`, target: "C:\\Windows\\System32\\cmd.exe" },
  { name: "Uninstall Foo", path: `${P}Foo\\Uninstall Foo.lnk`, target: "C:\\Program Files\\Foo\\unins000.exe" },
  { name: "Foo", path: `${P}Foo\\Foo.lnk`, target: "C:\\Program Files\\Foo\\foo.exe" },
  { name: "Foo Website", path: `${P}Foo\\Foo Website.lnk`, target: "C:\\Program Files\\Foo\\website.url" },
  { name: "Sneaky Notes", path: `${P}Sneaky Notes.lnk`, target: "C:\\Windows\\System32\\cmd.exe" },
  { name: "Bitwarden", path: `${P}Bitwarden.lnk`, target: "C:\\Program Files\\Bitwarden\\Bitwarden.exe" },
  { name: "Google Chrome", path: "C:\\Users\\m\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Google Chrome.lnk", target: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" },
];
const name = (m: ReturnType<typeof findApp>) => ("app" in m ? m.app.name : `ERR ${m.error}`);

test("an app is found by its name, whatever the case or accents", () => {
  assert.equal(name(findApp(apps, "excel")), "Excel");
  assert.equal(name(findApp(apps, "Google Chrome")), "Google Chrome"); // listed twice: still one app
  assert.equal(name(findApp(apps, "chrome")), "Google Chrome");
  assert.equal(name(findApp(apps, "vs code")), "ERR No installed app is called \"vs code\" (Start menu and Microsoft Store apps were searched; the Store list is read a few seconds after oovi starts). Check the name, or the app may not be installed: if the user wants it opened anyway, take a screenshot and open it from a shortcut you see on the desktop or in an open window.");
  assert.equal(name(findApp(apps, "Visual Studio Code")), "Visual Studio Code");
});

test("two different apps that fit: the bot must say which", () => {
  assert.match(name(findApp(apps, "visual studio")), /^ERR Several apps match "visual studio": Visual Studio Code, Visual Studio 2022/);
});

test("terminals, uninstallers, password managers and shortcuts to them are never opened", () => {
  assert.match(name(findApp(apps, "PowerShell")), /doesn't let bots open "Windows PowerShell"/);
  assert.match(name(findApp(apps, "Command Prompt")), /doesn't let bots open/);
  assert.match(name(findApp(apps, "Uninstall Foo")), /doesn't let bots open/);
  assert.match(name(findApp(apps, "Bitwarden")), /doesn't let bots open/);
  // A harmless name pointing at cmd.exe is judged by what it starts, not by its name.
  assert.match(name(findApp(apps, "Sneaky Notes")), /doesn't let bots open "Sneaky Notes"/);
  assert.match(name(findApp(apps, "Foo Website")), /isn't a program/);
  assert.equal(name(findApp(apps, "Foo")), "Foo"); // the app itself, not its uninstaller or its web link
});

test("nonsense input is refused; unknown apps get a useful answer", () => {
  assert.match(name(findApp(apps, "")), /^ERR Give the app's name/);
  assert.match(name(findApp(apps, "x".repeat(200))), /^ERR Give the app's name/);
  assert.match(name(findApp(apps, "ChatGPT")), /Start menu and Microsoft Store apps were searched/);
  assert.match(name(findApp(apps, "..\\..\\Windows\\System32\\cmd.exe")), /^ERR No installed app/);
  assert.equal(blockedApp({ name: "Run script", path: "x.lnk", target: "C:\\a\\go.bat" }), "It can run commands or change the system");
  assert.equal(blockedApp({ name: "Paint", path: "x.lnk" }), null); // target unknown: the name decides
});

test("Microsoft Store apps can be opened by name; system and password packages can't", () => {
  const apps = [
    { name: "WhatsApp", path: "shell:AppsFolder\\5319275A.WhatsAppDesktop_cv1g1gvanyjgm!App", store: true },
    { name: "Terminal", path: "shell:AppsFolder\\Microsoft.WindowsTerminal_8wekyb3d8bbwe!App", store: true },
    { name: "Bitwarden", path: "shell:AppsFolder\\8bitSolutionsLLC.bitwardendesktop_h4e712dmw3xyy!bitwardendesktop", store: true },
    { name: "Odd", path: "shell:AppsFolder\\..\\..\\Windows\\System32\\cmd.exe", store: true },
  ];
  const ok = findApp(apps, "whatsapp");
  assert.ok("app" in ok && ok.app.path.endsWith("WhatsAppDesktop_cv1g1gvanyjgm!App"));
  assert.ok("error" in findApp(apps, "Terminal"));
  assert.ok("error" in findApp(apps, "Bitwarden"));
  assert.ok("error" in findApp(apps, "Odd"));
});

test("the Store apps a real Windows lists: Settings, Terminal and Windows Security are refused, the others can open", () => {
  // As read on GitHub's windows-latest by tests/win/windows-check.cjs (2026-11-12).
  const real = [
    ["Feedback Hub", "Microsoft.WindowsFeedbackHub_8wekyb3d8bbwe!App", true],
    ["Get Started", "MicrosoftWindows.Client.CBS_cw5n1h2txyewy!WebExperienceHost", true],
    ["Settings", "windows.immersivecontrolpanel_cw5n1h2txyewy!microsoft.windows.immersivecontrolpanel", false],
    ["Terminal", "Microsoft.WindowsTerminal_8wekyb3d8bbwe!App", false],
    ["Windows Security", "Microsoft.SecHealthUI_8wekyb3d8bbwe!SecHealthUI", false],
  ] as const;
  for (const [name, id, ok] of real) assert.equal(blockedApp({ name, path: `shell:AppsFolder\\${id}`, store: true }) === null, ok, name);
});
