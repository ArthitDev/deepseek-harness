#!/bin/sh
set -eu

fail() { printf 'Kali readiness failed: %s\n' "$*" >&2; exit 1; }
case "${1:-offline}" in
    offline|online) mode=${1:-offline} ;;
    *) printf 'usage: check.sh [offline|online]\n' >&2; exit 2 ;;
esac

[ "$(id -u)" = 0 ] || fail 'expected container root'
grep -Eq '^NoNewPrivs:[[:space:]]+1$' /proc/self/status || fail 'no-new-privileges is required'
grep -Eq '^Seccomp:[[:space:]]+2$' /proc/self/status || fail 'seccomp filtering is required'
for field in CapEff CapPrm CapBnd; do
    grep -Eq "^$field:[[:space:]]+0*2000$" /proc/self/status || fail "$field must contain only NET_RAW"
done
[ -z "$(dpkg --audit)" ] || fail 'dpkg has incomplete packages; rebuild the image'
apt-get check
while IFS= read -r package; do
    [ "$(dpkg-query -W -f='${Status}' "$package")" = 'install ok installed' ] || fail "package missing: $package"
done < /usr/local/share/dsh-kali/packages.txt
for setting in 'APT::Sandbox::User "root";' 'Acquire::ForceIPv4 "true";' 'APT::Update::Error-Mode "any";'; do
    apt-config dump | grep -Fx "$setting" >/dev/null || fail "APT configuration missing: $setting"
done
for directory in /var/cache/apt/archives/partial /var/lib/apt/lists/partial; do
    [ "$(stat -c '%u:%g:%a' "$directory")" = '0:0:700' ] || fail "incorrect cache ownership: $directory"
done
for spec in '/var/log/redis adm 2750' '/var/lib/redis redis 750' '/etc/redis redis 2770'; do
    set -- $spec
    [ "$(stat -c '%U %G %a' "$1")" = "redis $2 $3" ] || fail "incorrect Redis directory: $1"
    [ "$(dpkg-statoverride --list "$1")" = "redis $2 $3 $1" ] || fail "missing Redis ownership override: $1"
done
nmap_caps=$(dpkg-query -L nmap | while IFS= read -r file; do
    if [ -f "$file" ]; then getcap "$file"; fi
done)
[ -z "$nmap_caps" ] || fail 'nmap has file capabilities outside the runtime bounding set'
for tool in nmap sqlmap nuclei zaproxy java gobuster ffuf hydra whatweb redis-cli mysql psql feroxbuster httpx katana rustc cargo rustfmt cargo-clippy go node python3 uv uvx; do
    command -v "$tool" >/dev/null || fail "command missing: $tool"
done
nmap --version >/dev/null
rustc --version
go version
node --version
python3 --version
uv --version

if [ "$mode" = online ]; then
    apt-get update
    apt-get --download-only --no-remove --reinstall -y install hello
fi
printf 'Kali readiness passed (%s)\n' "$mode"
