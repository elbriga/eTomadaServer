#!/bin/bash

HOST=$1
ENDPOINT=$2
JSON=$3

uso() {
    echo "USO: ./api.sh HOST [ENDPOINT] [JSON]"
    echo
    exit 1
}
[[ -z "$HOST" ]] && uso

[[ -z "$ENDPOINT" ]] && ENDPOINT=getSnapshot

URL="http://$HOST/api/$ENDPOINT"

if [ ! -z "$JSON" ]; then
    echo "POST para [$URL]"
    echo "$JSON" | grep -q "\"getFile\":\"" && MODO_DOWNLOAD=1
    if [ "$MODO_DOWNLOAD" == "1" ]; then
        curl -s -v -X POST "$URL" -H "Content-Type: application/json" -d "$JSON"
    else
        curl -s -v -X POST "$URL" -H "Content-Type: application/json" -d "$JSON" | jq .
    fi
else
    echo "GET para [$URL]"
    curl -s -v "$URL" | jq .
fi

echo
echo
