# opencode-agentic-orchestration

Router de modelos para el **plan GO de opencode**. Dado un input del usuario, recomienda en <1 segundo el modelo óptimo del catálogo GO — equilibrando calidad, velocidad y precio — y aprende de tus decisiones con el tiempo.

---

## Cómo funciona

```
Input  →  Clasificador (Haiku/Flash, ~300ms)  →  Ranker (local, 0ms)  →  Top-3 con razón
                                                        ↑
                                           profiles.json  +  feedback.db
```

1. **Clasificador** — llama a un modelo barato para extraer features del input: `task_type`, `complexity`, `scope`, `needs_tools`, etc.
2. **Ranker** — función pura, sin llamadas externas. Puntúa cada modelo del catálogo GO contra las features. Al inicio corre en *shadow mode* (solo observa); tras 50 muestras el feedback real influye en el ranking.
3. **profiles.json** — métricas reales scrapeadas de artificialanalysis, openrouter y livebench. Se regenera automáticamente cada lunes via GitHub Actions.

---

## Estructura del proyecto

```
src/
├── lib/
│   ├── models/
│   │   ├── opencode_go_catalog.ts   # Catálogo de 14 modelos GO + variantes
│   │   └── profiles.json            # Métricas generadas (NO editar a mano)
│   ├── rag/
│   │   ├── build_profiles.ts        # CLI: orquesta scrapers → profiles.json
│   │   ├── scrape_artificialanalysis.ts
│   │   ├── scrape_openrouter.ts
│   │   ├── scrape_livebench.ts
│   │   ├── check_opencode_catalog.ts
│   │   ├── fuzzy_resolve.ts
│   │   └── scrape_log.ts
│   ├── features/
│   │   └── schema.ts                # Taxonomía de features (Zod)
│   ├── classifier/
│   │   └── extract.ts               # Clasificador con LRU cache
│   ├── router/
│   │   ├── rank.ts                  # Ranker puro (sin llamadas externas)
│   │   └── graph.ts                 # Pipeline LangGraph
│   ├── feedback/
│   │   ├── db.ts                    # SQLite local (better-sqlite3)
│   │   └── capture.ts               # Señales: accepted / switched / rated
│   └── notify/
│       ├── index.ts                 # Selector por NOTIFY_CHANNEL
│       ├── telegram.ts
│       ├── discord.ts
│       ├── ntfy.ts
│       └── email.ts
├── app/
│   ├── actions/
│   │   ├── route.ts                 # Server Action: suggestModel()
│   │   └── feedback.ts              # Server Action: recordFeedback()
│   └── tui-client.tsx               # UI estilo terminal
.github/
└── workflows/
    └── refresh-profiles.yml         # Cron semanal + workflow_dispatch
docs/
└── scrape_log.md                    # Log de scraping (append-only)
```

---

## Requisitos

- Node.js 20+
- npm
- Una API key de **OpenAI** o **DeepSeek** para el clasificador (el modelo barato)
- Cuenta de GitHub (para el cron de scraping)
- Opcional: bot de Telegram para notificaciones

---

## Setup inicial

### 1. Clonar e instalar

```bash
git clone https://github.com/TU_USUARIO/opencode-agentic-orchestration.git
cd opencode-agentic-orchestration
npm install
npx playwright install chromium   # solo necesario para scraping local
```

### 2. Configurar variables de entorno

```bash
cp .env.example .env
```

Edita `.env`:

```env
# Modelo clasificador (recomendado: deepseek es más barato)
CLASSIFIER_PROVIDER=deepseek
CLASSIFIER_MODEL=deepseek-chat
DEEPSEEK_API_KEY=sk-...

# O si prefieres OpenAI:
# CLASSIFIER_PROVIDER=openai
# CLASSIFIER_MODEL=gpt-4o-mini
# OPENAI_API_KEY=sk-...

# Notificaciones (opcional — ver sección Telegram más abajo)
NOTIFY_CHANNEL=telegram
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
```

### 3. Levantar la app

```bash
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000). Verás la TUI en el browser.

---

## Scraping de perfiles (profiles.json)

`profiles.json` contiene las métricas reales de cada modelo GO: precio, velocidad, benchmarks, etc. **No editar a mano** — se genera con el scraper.

### Prueba local rápida (1 modelo, sin escribir archivos)

```bash
npm run fetch:profiles -- --limit 1 --dry
```

### Correr el scraper completo localmente

```bash
npm run fetch:profiles
```

Escribe `src/lib/models/profiles.json` y añade una entrada en `docs/scrape_log.md`.

### Con páginas de providers (más datos, más lento)

```bash
npm run fetch:profiles -- --providers
```

---

## GitHub Actions — scraping automático semanal

El workflow `.github/workflows/refresh-profiles.yml` corre cada lunes a las 06:00 UTC, scrapea todos los modelos, commitea `profiles.json` y `scrape_log.md` al repo, y notifica por Telegram si hay errores o modelos nuevos/removidos.

### Configurar el repo en GitHub

1. Haz push del proyecto a GitHub:

```bash
git remote add origin https://github.com/TU_USUARIO/TU_REPO.git
git push -u origin main
```

2. Ve a **Settings → Secrets and variables → Actions** y añade:

| Secret | Valor |
|--------|-------|
| `TELEGRAM_BOT_TOKEN` | Token de tu bot |
| `TELEGRAM_CHAT_ID` | ID de tu chat |
| `NOTIFY_CHANNEL` | `telegram` (o `discord`, `ntfy`, `email`) |
| `DISCORD_WEBHOOK_URL` | Solo si usas Discord |
| `NTFY_TOPIC` | Solo si usas ntfy.sh |
| `RESEND_API_KEY` | Solo si usas email |
| `NOTIFY_EMAIL_TO` | Solo si usas email |

3. El workflow necesita permisos de escritura. Ve a **Settings → Actions → General → Workflow permissions** y selecciona **Read and write permissions**.

### Trigger manual

Desde GitHub: **Actions → refresh-profiles → Run workflow**.

Con la opción `Also scrape /providers pages` marcada, extrae métricas adicionales por provider.

---

## Configurar notificaciones por Telegram

1. Habla con [@BotFather](https://t.me/BotFather) en Telegram → `/newbot` → copia el token.
2. Envía cualquier mensaje a tu bot.
3. Obtén tu `chat_id`:
   ```
   https://api.telegram.org/bot<TOKEN>/getUpdates
   ```
   Busca `"chat":{"id":...}` en la respuesta.
4. Pon ambos valores en `.env` o en los Secrets de GitHub.

El bot te avisará cuando:
- Hay errores de scraping
- Se detecta un modelo nuevo o removido en el catálogo GO
- Un slug no se pudo resolver ni con fuzzy search

---

## Añadir un modelo nuevo al catálogo

Cuando Telegram notifique `model_added`, edita `src/lib/models/opencode_go_catalog.ts` y añade la entrada:

```ts
{
  name: "Nombre del modelo",
  providers_opencode: ["Provider que usa opencode"],
  sdk: "openai_compatible",           // o "anthropic" o "alibaba"
  variants: ["high"],                  // variantes de razonamiento disponibles
  slug_or: "provider/modelo-slug",    // slug en openrouter
  slug_oa_by_variant: {
    "high": "modelo-slug-high",       // slug en artificialanalysis por variante
  },
},
```

Los slugs correctos los encuentras en:
- artificialanalysis: en la URL de la página del modelo
- openrouter: en `https://openrouter.ai/api/v1/models` buscando el nombre

Después de editar, corre el scraper para regenerar `profiles.json`.

---

## Cómo funciona el feedback loop

El router aprende de lo que haces en la TUI:

| Acción | Señal | Peso |
|--------|-------|------|
| Usar el modelo recomendado | `accepted` | 1.0 |
| Cambiar a otro modelo | `switched` | 1.0 |
| 👍 después de usarlo | `rated_up` | 1.0 |
| 👎 después de usarlo | `rated_down` | 1.0 |
| Continuar conversación | `continued` | 0.5 |
| Regenerar respuesta | `regenerated` | 0.3 |

**Shadow mode**: las primeras 50 muestras para cada combinación de features, el feedback se registra pero **no influye** en el ranking. Esto te permite validar que el router recomienda bien antes de confiar en él.

El umbral se configura en `.env`:
```env
FEEDBACK_SHADOW_THRESHOLD=50
FEEDBACK_DB_PATH=./data/feedback.db
```

---

## Scripts disponibles

```bash
npm run dev               # Levantar Next.js en desarrollo
npm run build             # Build de producción
npm run start             # Servidor de producción
npm run typecheck         # Verificar tipos TypeScript
npm run fetch:profiles    # Scraping completo → profiles.json
npm run fetch:profiles -- --limit N    # Solo N modelos (pruebas)
npm run fetch:profiles -- --dry        # Sin escribir archivos
npm run fetch:profiles -- --providers  # Con páginas de providers
npm run test              # Tests unitarios
```

---

## Presupuesto de coste/latencia

| Escenario | Latencia añadida | Costo por query |
|-----------|-----------------|-----------------|
| Cache miss (clasificación nueva) | 300–500 ms | ~$0.0001 |
| Cache hit (input repetido) | ~5 ms | $0 |
| Scraping semanal completo | ~15 min | $0 (GitHub Actions gratis) |

Si el pipeline supera 800 ms o $0.0005, se considera regresión.

---

## Despliegue en producción

El proyecto es un Next.js estándar. Funciona en:

- **Vercel** (recomendado — zero config):
  ```bash
  npx vercel --prod
  ```
  Añade las variables de entorno en el dashboard de Vercel.

- **Self-hosted** con Docker o cualquier servidor Node:
  ```bash
  npm run build
  npm run start
  ```

> **Nota**: el feedback DB usa SQLite (`better-sqlite3`) que requiere sistema de archivos persistente. En Vercel usa una ruta en `/tmp` o apunta `FEEDBACK_DB_PATH` a un volumen externo.

---

## Troubleshooting

**El proceso `fetch:profiles` no termina**
Ya está corregido en el código (`process.exit(0)` al finalizar). Si persiste, es Playwright manteniendo el browser abierto — reporta el modelo que falla.

**`profiles.json` está vacío o tiene `null` en todo**
El scraper no encontró el slug del modelo. Revisa `docs/scrape_log.md` para ver qué falló. Probablemente el slug en `opencode_go_catalog.ts` no coincide con el de artificialanalysis/openrouter.

**Error `CLASSIFIER_PROVIDER=anthropic` no soportado**
El clasificador solo soporta `openai` y `deepseek`. Cambia `CLASSIFIER_PROVIDER` en `.env`.

**La TUI no responde / error en Server Action**
Verifica que `.env` tenga al menos `CLASSIFIER_PROVIDER` y su API key correspondiente.
