#!/bin/bash

BASEDIR=/var/lib/eTomadaServer/backup
NODOS=/etc/etomada.hosts
FILES="automacoes nodosRemotos recursosRemotos"
NUMBACKUPS=7

# Obtém a data e hora atual no formato AAAAMM_DD-HHMMSS (Ex: 202610_18-215100)
AGORA=$(date +"%Y%m_%d-%H%M%S")

TOTN=`cat $NODOS | wc -l`
echo "[$AGORA] Iniciado Backup eTomada - [$TOTN] nodos cadastrados" >&2

for NODO in $(cat "$NODOS"); do
    DIR="$BASEDIR/$NODO"
    mkdir -p "$DIR" &> /dev/null
    
    # 1. Faz o teste da API salvando com timestamp
    FILE_SNAPSHOT="$DIR/snapshot_$AGORA.json"
    if api.sh "$NODO" > $FILE_SNAPSHOT 2> /dev/null; then
        # Testar se o nodo é Full
        if grep -qE '"api": *?"Full"' "$FILE_SNAPSHOT"; then
            echo "# Nodo $NODO FULL > Fazer backup:" >&2
        
            # 2. Busca cada um dos arquivos com timestamp
            for FILE in $FILES; do
                echo ">>> Buscando $NODO:/$FILE.json" >&2
                api.sh "$NODO" files "{\"getFile\":\"$FILE.json\"}" > "$DIR/${FILE}_$AGORA.json" 2> /dev/null
            done
            
            # 3. ROTINA DE ROTAÇÃO: Mantém apenas os $NUMBACKUPS mais recentes
            # Como o snapshot e os arquivos compartilham o mesmo timestamp, controlamos a limpeza por um deles (ex: snapshot)
            TOTAL_BACKUPS=$(ls -1 "$DIR"/snapshot_*.json 2>/dev/null | wc -l)
            
            if [ "$TOTAL_BACKUPS" -gt "$NUMBACKUPS" ]; then
                # Descobre quantos arquivos precisamos apagar
                APAGAR=$((TOTAL_BACKUPS - NUMBACKUPS))
                
                echo ">>>>>> Rotacionando backups de $NODO: removendo os $APAGAR mais antigos." >&2
                
                # Lista os timestamps mais antigos ordenados por data de modificação (os mais velhos primeiro)
                # e extrai exatamente o padrão de data correspondente para apagar todos os arquivos daquele momento
                ls -1tr "$DIR"/snapshot_*.json | head -n "$APAGAR" | while read -r antigo_snap; do
                    # Extrai o timestamp do nome do arquivo (ex: 202610_18-215100)
                    TIMESTAMP_ANTIGO=$(echo "$antigo_snap" | grep -oE '[0-9]{6}_[0-9]{2}-[0-9]{6}')
                    
                    if [ -n "$TIMESTAMP_ANTIGO" ]; then
                        # Remove o snapshot e todos os arquivos gerados naquele mesmo horário
                        rm -f "$DIR"/*_"$TIMESTAMP_ANTIGO".json
                    fi
                done
            fi
        else
            echo "# Nodo $NODO: Light = sem backup" >&2
        fi
    else
        echo "# Nodo $NODO: OFFLINE" >&2
    fi
done
