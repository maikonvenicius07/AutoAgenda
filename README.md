# Mau-Mau Candeias — V40.4

Jogo Mau-Mau Candeias multiplayer para navegador, com salas de 2 a 5 jogadores, Login Google obrigatório, Socket.IO, ranking PostgreSQL e recursos de presença online.

## Recursos atuais

- **Login Google obrigatório** com sessão própria em cookie HttpOnly.
- **Salas multiplayer** de 2 a 5 jogadores e modo contra máquinas.
- **Jogadores Online + Convites** com presença identificada pela Conta Google.
- **Buscar Jogadores**: matchmaking automático de 2 a 5 pessoas; a janela de 15 s começa quando o segundo jogador entra e a partida inicia imediatamente ao chegar a 5.
- **Reconexão Inteligente**: 60 s para retornar; depois a Máquina assume temporariamente a mesma vaga e o jogador retoma o controle quando volta.
- **SUA VEZ melhorado** com animação, iluminação, som e vibração opcional.
- **Áudio Rápido** de até 15 segundos, temporário na sala e sem gravação no PostgreSQL.
- **Música dinâmica original**, com volume independente e ducking durante falas/áudios.
- **Chat e efeitos compartilhados**.
- **Conferência da Rodada** com cartas restantes e cálculo da pontuação.
- **Ranking PostgreSQL** por período e modalidade.
- Interface adaptada para computador e celular.

As regras consolidadas do jogo estão em [`docs/REGRAS.md`](docs/REGRAS.md).

## Stack

- Node.js 18+
- Express
- Socket.IO
- PostgreSQL (`pg`)
- Google Identity Services + `google-auth-library`
- HTML, CSS e JavaScript no front-end

## Estrutura do projeto

```text
.
├── bot-player.js
├── game-engine.js
├── ranking-store.js
├── server.js
├── package.json
├── render.yaml
├── public/
│   ├── app.js
│   ├── index.html
│   ├── styles.css
│   └── assets/
│       ├── avatars/
│       └── music/
├── tests/
│   ├── run-all.js
│   └── *.test.js
└── docs/
    ├── DEPLOY_RENDER.md
    └── REGRAS.md
```

## Executar localmente

1. Instale Node.js 18 ou superior.
2. Na pasta do projeto, execute:

```bash
npm install
```

3. Copie `.env.example` para `.env` apenas como referência. Este projeto não carrega `.env` automaticamente; defina as variáveis no terminal/sistema operacional ou na plataforma de hospedagem.
4. Configure pelo menos `GOOGLE_CLIENT_ID` e `AUTH_SESSION_SECRET`.
5. Inicie:

```bash
npm start
```

Por padrão, o servidor usa a porta definida em `PORT` ou 3000.

### Ranking local

Sem `DATABASE_URL`, o ranking usa `data/ranking.json` como fallback local. A pasta `data/` está no `.gitignore` para não publicar dados de partidas no GitHub.

## Testes

Execute toda a suíte:

```bash
npm test
```

O runner executa automaticamente todos os arquivos `tests/*.test.js`. Isso evita manter uma lista manual de testes no `package.json` e reduz o risco de um teste novo ficar fora da suíte.

Para validar também a sintaxe dos arquivos principais:

```bash
npm run verify
```

## Variáveis de ambiente

| Variável | Uso |
|---|---|
| `GOOGLE_CLIENT_ID` | Client ID OAuth Web usado para validar o Login Google. |
| `AUTH_SESSION_SECRET` | Assina a sessão própria do jogo. Use valor longo, aleatório e estável. |
| `DATABASE_URL` | Conexão PostgreSQL usada pelo ranking. Recomendada em produção. |
| `PORT` | Porta HTTP. Plataformas como Render normalmente a fornecem. |
| `PGSSLMODE` | Opcional; `disable` desativa SSL do PostgreSQL quando explicitamente necessário. |
| `RANKING_FILE` | Opcional; caminho alternativo para o fallback JSON local. |

**Nunca coloque valores reais de `DATABASE_URL`, `AUTH_SESSION_SECRET` ou outros segredos no GitHub.**

## Deploy no Render

O projeto já inclui `render.yaml`. As instruções consolidadas de Login Google, PostgreSQL e deploy estão em [`docs/DEPLOY_RENDER.md`](docs/DEPLOY_RENDER.md).

## Música

As sete trilhas em `public/assets/music/` foram criadas especificamente para o projeto. A declaração de origem está em `public/assets/music/ORIGEM_E_LICENCA.txt`.

## Histórico

O histórico resumido das principais versões está em [`CHANGELOG.md`](CHANGELOG.md).


## Ajuste da abertura
A primeira carta normal virada da rodada pode ser queimada por qualquer jogador que tenha uma cópia exatamente igual, mesmo fora da vez.

## Jogar de novo
Ao concluir uma partida entre pessoas, os jogadores podem confirmar **JOGAR DE NOVO** e iniciar outra partida na mesma sala, com placar zerado.
