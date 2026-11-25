# Landing page do Ad+ (adplus.app.br)

- `index.html`: a página (HTML, CSS e o círculo de partículas em canvas, tudo num arquivo).
- `worker.js`: código do Worker `adplus-site` no Cloudflare. Ele busca `index.html` deste repositório (cache de 5 min) e entrega no domínio.

Para mudar o site: edite `index.html` e faça push na `main`. Em até 5 minutos o site mostra a versão nova.
