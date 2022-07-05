#!/usr/bin/env bash

# temp code that installs unbuffer without the need to pull the container again
# remove this code in about 3-4 months when all probes should have the container pulled
ARCHLOCAL=$(dpkg --print-architecture)

if [[ ! -f "/usr/bin/unbuffer" ]]; then

curl "http://ftp.nl.debian.org/debian/pool/main/e/expect/tcl-expect_5.45.4-2+b1_${ARCHLOCAL}.deb" -o "/tmp/tcl-expect.deb"
dpkg --extract "/tmp/tcl-expect.deb" /

curl "http://ftp.nl.debian.org/debian/pool/main/t/tcl8.6/libtcl8.6_8.6.11+dfsg-1_${ARCHLOCAL}.deb" -o "/tmp/libtcl.deb"
dpkg --extract "/tmp/libtcl.deb" /

curl "http://ftp.nl.debian.org/debian/pool/main/t/tcl8.6/tcl8.6_8.6.11+dfsg-1_${ARCHLOCAL}.deb" -o "/tmp/tcl.deb"
dpkg --extract "/tmp/tcl.deb" /

curl "http://ftp.nl.debian.org/debian/pool/main/e/expect/expect_5.45.4-2+b1_${ARCHLOCAL}.deb" -o "/tmp/expect.deb"
dpkg --extract "/tmp/expect.deb" /

fi
# end temp code
