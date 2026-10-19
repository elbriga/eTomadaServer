#!/bin/bash

HOST=$1
ENDPOINT=$2
JSON=$3

uso() {
    echo "USO: ./api.sh HOST [ENDPOINT] [JSON]" >&2
    echo >&2
    exit 1
}
[[ -z "$HOST" ]] && uso

[[ -z "$ENDPOINT" ]] && ENDPOINT=getSnapshot

URL="http://$HOST/api/$ENDPOINT"

if [ ! -z "$JSON" ]; then
    echo "> POST para [$URL]" >&2
    echo "$JSON" | grep -q "\"getFile\":\"" && MODO_DOWNLOAD=1
    if [ "$MODO_DOWNLOAD" == "1" ]; then
        echo "> MODO_DOWNLOAD" >&2
        curl --connect-timeout 3 -s -v -X POST "$URL" -H "Content-Type: application/json" -d "$JSON"
        RET=$?
    else
        curl --connect-timeout 3 -s -v -X POST "$URL" -H "Content-Type: application/json" -d "$JSON" | jq .
        RET=${PIPESTATUS[0]} 
    fi
else
    echo "> GET para [$URL]" >&2
    curl --connect-timeout 3 -s -v "$URL" | jq .
    RET=${PIPESTATUS[0]} 
fi

echo >&2
echo >&2

exit $RET
