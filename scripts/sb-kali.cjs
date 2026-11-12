const path = require('node:path');
const os = require('node:os');

/** Select the current host's configured Kali backend without trying another OS. */
function kaliInvocation(script, distro = 'kali-linux') {
  if (os.platform() === 'win32') {
    return { command: 'wsl.exe', args: ['-d', distro, '-u', 'root', '--exec', '/bin/bash', '-c', script] };
  }
  if (os.platform() === 'linux') {
    const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
    return { command: path.join(home, 'kali-shell'), args: ['-c', script] };
  }
  throw new Error(`Kali backend is not configured for ${os.platform()}`);
}

/** Preserve mounted Linux paths; translate Windows drive paths for WSL. */
function toKaliPath(file) {
  if (os.platform() !== 'win32') return path.resolve(file);
  const full = path.win32.resolve(file);
  if (!/^[a-z]:\\/i.test(full)) throw new Error(`Kali requires a mounted Windows drive path: ${full}`);
  return `/mnt/${full[0].toLowerCase()}/${full.slice(3).replace(/\\/g, '/')}`;
}

module.exports = { kaliInvocation, toKaliPath };
