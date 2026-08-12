# Deploy em VPS existente

Esta configuracao e destinada a uma VPS que ja possui outros servicos Docker e Apache.
Ela mantem o Compose local intacto e usa nomes, volume e porta proprios para o mtalk-bot.

## Caracteristicas

- O app roda compilado em `node dist/server.js`.
- O PostgreSQL nao publica a porta `5432` no host.
- O app publica somente `127.0.0.1:3001` por padrao.
- O Apache pode encaminhar um subdominio para `http://127.0.0.1:3001`.
- O volume do banco se chama `mtalk_bot_prod_postgres_data`.

## Preparacao da VPS

1. Instale ou confirme Docker e Docker Compose.
2. Crie um diretorio exclusivo, por exemplo `/opt/mtalk-bot`.
3. Copie o projeto para esse diretorio, sem enviar `node_modules` ou o arquivo `.env` por canais inseguros.
4. Crie o `.env` diretamente na VPS com as credenciais de producao.
5. Confirme que o subdominio escolhido aponta para o IP publico da VPS.

## Validacao antes de subir

No diretorio do projeto:

```bash
docker compose -f docker-compose.production.yml config
```

Esse comando deve terminar sem erro e nao altera containers.

## Subida inicial

```bash
docker compose -f docker-compose.production.yml up -d --build
```

Depois confira:

```bash
docker compose -f docker-compose.production.yml ps
```

```bash
curl http://127.0.0.1:3001/health
```

## Atualizacao posterior

1. Faca backup do PostgreSQL.
2. Copie a nova versao do projeto para a VPS.
3. Execute `docker compose -f docker-compose.production.yml up -d --build`.
4. Confira os logs e o endpoint `/health`.

Nao use `docker compose down -v`, pois o parametro `-v` remove o volume do banco.
