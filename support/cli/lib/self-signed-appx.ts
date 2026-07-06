import fs from "node:fs";
import path from "node:path";
import { PROJECT_HOME, projectVersion } from "@/cli/lib/paths";
import { capture, run, runEnv } from "@/cli/lib/process";

// Windows-only self-signed AppX signing chain (openssl -> jsign), ported 1:1 from tasks.py. Kept
// for parity; the artifact names are the Electron-era `.exe`/`.appx` in release/.

const TIMESTAMP_URLS = [
  "http://timestamp.sectigo.com/rfc3161",
  "http://timestamp.globalsign.com/scripts/timstamp.dll",
  "http://timestamp.comodoca.com/authenticode",
  "http://sha256timestamp.ws.symantec.com/sha256/timestamp",
].join(",");

export function uninstallSelfSignedAppx(): void {
  const result = capture(
    'powershell.exe -Command "(Get-AppxPackage | Select Name, PackageFullName | ConvertTo-Json)"',
    { allowFailure: true },
  );
  try {
    const parsed = JSON.parse(result.stdout || "[]");
    const items = Array.isArray(parsed) ? parsed : [parsed];
    for (const app of items) {
      if (String(app.Name).includes("ContainerDesktop")) {
        console.log(`Appx already installed: ${app.Name} - removing ${app.PackageFullName}`);
        run(`powershell.exe -Command "Remove-AppxPackage -Package \\"${app.PackageFullName}\\""`);
      }
    }
  } catch {
    console.log("Unable to parse appx list");
  }
}

export function installSelfSignedAppx(): void {
  uninstallSelfSignedAppx();

  const root = PROJECT_HOME;
  const pfxPath = path.join(root, "temp/self-signed.pfx");
  if (!fs.existsSync(pfxPath)) {
    console.log("Certificate not found - generating");
    const certConfig = path.join(root, "support/openssl.conf");
    const privateKey = path.join(root, "temp/self-signed-private.key");
    if (!fs.existsSync(privateKey)) {
      console.log(`Private key not found at ${privateKey} - generating`);
      run(`openssl genrsa -out ${privateKey} 2048`);
    }
    fs.mkdirSync(path.join(root, "temp"), { recursive: true });
    const csrPath = path.join(root, "temp/self-signed.csr");
    if (!fs.existsSync(csrPath)) {
      console.log(`CSR not found at ${csrPath} - generating`);
      run(`openssl req -new -key ${privateKey} -out ${csrPath} -config ${certConfig}`);
    }
    const certPath = path.join(root, "temp/self-signed.crt");
    if (!fs.existsSync(certPath)) {
      console.log(`Certificate not found at ${certPath} - generating`);
      run(
        `openssl x509 -req -in ${csrPath} -signkey ${privateKey} -out ${certPath} ` +
          `-days 365 -extensions v3_req -extfile ${certConfig}`,
      );
    }
    if (!fs.existsSync(pfxPath)) {
      console.log(`PFX not found at ${pfxPath} - generating`);
      run(
        `openssl pkcs12 -export -out ${pfxPath} -inkey ${privateKey} -in ${certPath} ` +
          '-name "Container Desktop" -passout pass:123456',
      );
    }
  }

  const jarPath = path.join(root, "temp/jsign-6.0.jar");
  const version = projectVersion();
  const exePath = path.join(root, "release", `container-desktop-x64-${version}.exe`);
  const appxPath = path.join(root, "release", `container-desktop-x64-${version}.appx`);

  for (const bundle of [exePath, appxPath]) {
    if (fs.existsSync(bundle)) {
      console.log(`Signing ${bundle}`);
      fs.copyFileSync(bundle, `${bundle}.unsigned`);
      runEnv(
        `java -jar "${jarPath}" --keystore ${pfxPath} --storetype PKCS12 --storepass 123456"" ` +
          `--tsaurl "${TIMESTAMP_URLS}" "${bundle}"`,
      );
    }
  }
}
