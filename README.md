## eTomadaServer

- log server com API e frontend
- firmware server para os arquivos estaticos

## RUN

Defina as credenciais usadas para acessos pelo tunnel Cloudflare:

```sh
export WEB_AUTH_USERNAME='seu-usuario'
export WEB_AUTH_PASSWORD='uma-senha-forte'
```

Depois inicie ou recrie o servidor:

```sh
docker compose up -d --build
```

Requisicoes que chegam com o header `CF-Connecting-IP` pedem autenticacao HTTP Basic. A pagina de login do navegador tambem protege as APIs e os arquivos estaticos. Sem as duas variaveis configuradas, esses acessos retornam `503`; acessos sem o header continuam sem autenticacao.

## CHECK

docker compose ps
E
docker compose logs -f
