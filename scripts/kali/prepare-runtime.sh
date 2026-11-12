#!/bin/sh
set -eu

# Only image builds have the ownership capabilities package setup requires.
install -d -o root -g root -m 700 /var/cache/apt/archives/partial /var/lib/apt/lists/partial
for spec in '/var/log/redis adm 2750' '/var/lib/redis redis 750' '/etc/redis redis 2770'; do
    set -- $spec
    install -d -o redis -g "$2" -m "$3" "$1"
    dpkg-statoverride --add redis "$2" "$3" "$1"
done

dpkg-query -L nmap | while IFS= read -r file; do
    if [ -f "$file" ] && [ -n "$(getcap "$file")" ]; then
        setcap -r "$file"
    fi
done
if ! command -v httpx >/dev/null 2>&1; then
    ln -s /usr/bin/httpx-toolkit /usr/local/bin/httpx
fi
