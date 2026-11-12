FROM ghcr.io/astral-sh/uv:0.9.16@sha256:ae9ff79d095a61faf534a882ad6378e8159d2ce322691153d68d2afac7422840 AS uv
FROM kalilinux/kali-rolling@sha256:6ec743d9fc5cd397451eeddeff3869bcfab5de9bd5dec5b1f34cbfbd80313073

ENV DEBIAN_FRONTEND=noninteractive

# Bootstrap TLS with the official image's signed APT source.
RUN apt-get -o APT::Update::Error-Mode=any -o Acquire::ForceIPv4=true -o Acquire::Retries=2 update \
    && apt-get --no-install-recommends -y install ca-certificates
COPY kali.sources /etc/apt/sources.list.d/kali.sources
COPY packages.txt /usr/local/share/dsh-kali/packages.txt
RUN apt-get -o APT::Update::Error-Mode=any -o Acquire::ForceIPv4=true -o Acquire::Retries=2 update \
    && xargs -r apt-get --no-install-recommends -y install < /usr/local/share/dsh-kali/packages.txt \
    && apt-get check \
    && test -z "$(dpkg --audit)" \
    && dpkg-query -W -f='${binary:Package}\t${Version}\n' > /usr/local/share/dsh-kali/versions.tsv
COPY --from=uv /uv /uvx /usr/local/bin/
COPY apt.conf /etc/apt/apt.conf.d/99dsh-restricted-broker
COPY prepare-runtime.sh check.sh /usr/local/libexec/dsh-kali/
RUN chmod 755 /usr/local/libexec/dsh-kali/*.sh \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* \
    && /usr/local/libexec/dsh-kali/prepare-runtime.sh

WORKDIR /workspace
ENTRYPOINT ["/bin/bash"]
