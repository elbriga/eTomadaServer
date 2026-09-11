#!/bin/bash

FILE="/opt/etomada-log-server/data/etomadas.hosts"
FILE2="/opt/etomada-log-server/data/casa.hosts"

echo "Monitorando $FILE e $FILE2"

while true; do

    inotifywait \
        -e close_write \
        -e moved_to \
        -e create \
        "/etc/dnsmasq.d/dhcp.conf" "$FILE" "$FILE2"

    echo "Arquivo DNS alterado. Recarregando dnsmasq..."

    systemctl reload dnsmasq

done
