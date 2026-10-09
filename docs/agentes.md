# Agentes de la oficina

La oficina 3D es una agencia (web + marketing) cuyos trabajadores son agentes de IA. Trabajan de verdad sobre **tu producto**:

- investigan;
- diseñan;
- escriben y publican;
- se reúnen como profesionales y te entregan conclusiones.

Aprenden con el tiempo: en el año 5 saben más que en el año 1.

Todo corre en local. Cada persona que instala la app pone sus propias claves de IA y sus conectores (MCP).

## Cómo funciona el día

- **Reloj real** en tu zona horaria. No hay aceleración.
- **Interruptor «Trabajar»** en la barra superior.
  - Al encenderlo entran a trabajar todos los agentes activos.
  - Al apagarlo terminan lo que están haciendo y se van a casa.
- **Interruptor por agente** («Viene a trabajar»): desactiva a uno sin afectar al resto.
- **Sol real**: la luz entra por las ventanas según la hora y la ubicación (Ajustes). Amanece, atardece y de noche se encienden las lámparas.

## Plantilla por defecto

| Rol | Qué aporta |
|---|---|
| **Dirección** (jefe, raíz del árbol) | Prioridades, decisión final, te entrega las conclusiones |
| **Organizador / PM** | Orden del día, modera turnos, actas, convierte acuerdos en tareas |
| **Entrevistador / cuentas** | Te entrevista y convierte tus respuestas en briefs. El primer día rellena el perfil de tu empresa y tu producto. |
| **Investigador** | Competencia, mercado y tendencias, siempre con fuentes |
| **Dirección de arte** | Aprende de tus referencias, mantiene la guía de estilo y revisa cada pieza |
| **Diseño** | Marca, referencias visuales, piezas (imágenes, logos) |
| **Diseño UI/UX** | Interfaces, flujos, prototipos y usabilidad |
| **Dev / producto** | Viabilidad, coste, revisión de la web y la analítica |
| **Marketing** (ampliable a equipo) | Contenido, calendario, publicación y respuestas en redes |
| **Escéptico** (staff, fuera de la cadena) | Ronda por fuera de la oficina criticando lo que ve. Entra por la puerta a hablar con Dirección cuando tiene algo que decir. No manda en nadie y nadie le manda callar. |

**Puestos fijos:** Dirección (siempre el jefe, con su despacho), Organización (ronda por las mesas del equipo), Entrevistas (en la sala de reuniones; recibe y entrevista a cada agente nuevo) y Escéptico (ronda fuera) vienen con la oficina, uno de cada. Se pueden renombrar, personalizar y desactivar, no quitar ni cambiar de rol. Solo Dirección tiene mesa. El resto de agentes los añades tú: entran por la puerta a recepción, Entrevistas los recibe y los lleva a la sala de reuniones, y su mesa queda «por colocar» en el editor; al colocarla va a su sitio por defecto (dos columnas de tres en la zona de trabajo).

### Crear un agente describiéndolo

En «Añadir agente» explicas qué hará y pulsas **Organizar ficha**. Dirección (una llamada a su IA, `server/agentDraft.ts`) lo convierte en una ficha que revisas antes de crearlo:
- nombre, puesto, rol y a quién responde (solo jefes válidos);
- **qué hará**, **cómo es** (trayectoria, carácter, cómo habla, qué no tolera) y **en qué se centra** (4-6 prácticas).

Con ficha no hay entrevista: entra directo a su mesa. La ficha (`Worker.profile`) va en su prompt de sistema, en el chat contigo y en lo que ven sus compañeros de él. Se edita después en su ficha → Ajustes → «Editar su ficha». También se puede «Rellenar a mano».

### Plantillas de equipo

Organigrama → **Plantillas de equipo** (`src/sim/templates.ts`). Equipos listos, con un responsable y cada puesto con su ficha. Son genéricos: lo particular de tu proyecto lo sacan del dossier.

| Equipo | Responsable | Puestos |
|---|---|---|
| Estudio de arte | Dirección de arte | Fotografía y escenografía de producto, Diseño UI/UX, Diseño gráfico y redes, Identidad visual |
| Crecimiento | Responsable de crecimiento | SEO, Redes sociales, Copy y contenido |
| Producto | Lead de producto | Desarrollo frontend, QA y rendimiento |

- Antes de montarlo ves quién llega nuevo y quién de tu equipo **se incorpora** (por rol y por las palabras de su puesto: «identidad visual» → Identidad visual, «LinkedIn» → Redes sociales). Cada incorporación se puede desmarcar.
- El servidor rehace el plan y lo vuelve a validar (`ops.applyTemplate`); aplicarla otra vez no duplica a nadie.
- Si cabe, se monta una sala con el nombre del equipo junto a la oficina y se colocan allí sus mesas (`layout.addDeskInRoom`). Si no cabe, las mesas quedan en «Mesas por colocar».

**Persona ≠ rol.** Cada agente tiene, además del rol:
- carácter;
- trayectoria;
- relaciones (con quién congenia y con quién choca);
- forma de hablar.

Ante sus compañeros se comportan como personas reales. **Lo que te llega a ti es verificable:** toda afirmación sobre el mundo lleva su fuente.

## Jerarquía

- **Un árbol, no una lista.** Cada agente tiene un `reportsTo`. Por defecto todos dependen del jefe.
- **Supervisor** = cualquier agente con subordinados. Si marketing crece a 4 agentes, uno de ellos pasa a supervisarlos.
- **Organigrama** literal en el panel: se arrastra una tarjeta sobre otra para cambiar de jefe.
- **Límites:** profundidad máxima 3 (jefe → supervisor → agente). Sin ciclos. Un solo jefe.
- **Reuniones:** como mucho 6 personas, las sillas de la mesa. Van, por orden: Dirección, Organización, quienes dirigen un equipo, Entrevistas y el resto.
- **Ritmo de trabajo del equipo** (Ajustes → IA → Gasto): cuántos turnos de trabajo de mesa hay a la hora entre todos (Tranquilo 12, Normal 30, Intenso 60, o sin límite). Con equipos grandes es lo que más marca el gasto. Los turnos se reparten por quien lleva más tiempo sin trabajar.
- **Sugeridos para tu proyecto:** al abrir «Añadir agente», Dirección propone 2–4 puestos concretos según el dossier, el equipo y el trabajo abierto (una llamada a la IA, solo cuando algo ha cambiado o pides otras). Arriba van también las propuestas de contratación que el equipo te haya enviado. Sin IA, sugiere los roles que nadie cubre. Cuando tiene sugerencias nuevas lo dice en voz alta (burbuja sobre Dirección y aviso en «Para ti» con «Ver sugerencias»), y si el dossier o el equipo cambian lo repiensa sola, como mucho cada 6 h.

**Por qué un solo jefe:** con 6–8 agentes basta. Dos autoridades LLM se contradicen y producen reuniones sin fin. Los mandos intermedios solo se justifican a partir de unas 8–10 personas por jefe.

## Salas y reuniones

- **Cada equipo tiene su sala.** El supervisor pasea por ella de mesa en mesa y va primero a quien está bloqueado. También tiene su propia mesa y trabaja.
- **Sala de reuniones grande:** jefe, supervisores y Escéptico. Sin supervisores, va todo el equipo. Se puede invitar a un agente concreto cuando su tema lo pide.

**Protocolo:**
```
Organizador abre con el orden del día → cada uno aporta → Escéptico ataca → réplicas → Dirección decide → acta → bandeja «Informes»
```

**Cómo te preguntan** (reuniones, avisos y preguntas sueltas): el equipo sabe qué falta, así que guía él. Una pregunta cada vez sobre un dato concreto (qué hueco del dossier o qué tarea bloqueada), con 2-3 opciones o un ejemplo y para qué lo necesitan. Nunca «¿qué información falta?» ni jerga (QA, KPI, CTA…). Si respondes «no sé», te proponen una opción y te preguntan si te vale. Al bajar la salud, el aviso dice exactamente qué falta, qué está bloqueado y qué preguntas tienes pendientes.

**Escalado de decisiones:**
- Lo que afecta solo al equipo lo decide el supervisor.
- Lo que afecta a otro equipo, al presupuesto o a la marca sube al jefe.
- Lo que afecta a tu estrategia sube a ti.

## Dirección de arte y guía de estilo

`server/style.ts`, pestaña **Estilo** en la ficha de quien tenga el rol Dirección de arte.

- **Referencias:** las imágenes que le mandas en su chat, o las que subes en Estilo, se guardan para siempre (archivos fijados, que no cuentan para el límite de 300; como mucho 80 referencias).
- **Paleta exacta:** el navegador mide los colores reales de cada imagen (k-means sobre los píxeles, `src/ui/imagePrep.ts`) y reduce las muy grandes para que una IA con visión las acepte.
- **Análisis:** una a una, en segundo plano, como un equipo de producción que tuviera que repetirla: composición y cámara (plano, ángulo, focal, profundidad de campo), luz (principal, relleno, contra, dureza, temperatura en K, sombras, reflejos), color y etalonaje, materiales, escena y atrezo, mood, tipografía, por qué funciona, qué evitar y un prompt en inglés que reproduce el aspecto.
- **IA que ve:** la de la directora de arte si ve imágenes (Claude, Qwen 3.5+, Kimi K2.5+…); si no, con tus claves: Qwen 3.8 de Groq (rápido), Kimi K3 de NVIDIA (el más preciso, pero tarda minutos) y Llama 3.2 Vision. Comprobado en octubre de 2026: Groq ya no tiene Llama 4 y NVIDIA retiró Maverick.
- **Guía de estilo viva:** 20 s después de cada cambio, la directora de arte la reescribe mezclando lo nuevo, sin empezar de cero. Tiene secciones (Luz, Color, Composición, Escena, Materiales, Tipografía, Evitar), la paleta medida y un bloque en inglés para las imágenes. Lo que marcas «Me gusta» pesa el doble; lo que marcas «No» solo enseña qué evitar. Lo que tú escribes en «Editar guía» queda fijado. Hay «Rehacer con todas» y «Deshacer último cambio».
- **Uso:** el equipo de arte la lleva en su prompt (la directora, completa) y tiene `ver_guia_estilo`. La directora tiene además `revisar_imagen` (notas de 1 a 10 por apartado, qué falla y un prompt corregido). **Toda imagen generada en la oficina** lleva el bloque de estilo, salvo que pidas expresamente otro estilo (`sin_guia`).

## LinkedIn: tu voz, el humanizador y el plan semanal

Adaptado de [linkedin-agent-skill](https://github.com/Jakeschincariol/linkedin-agent-skill) (Jake Schincariol, MIT: aviso en `server/data/LICENSE-linkedin-agent-skill`), en español. Todo vive en Ajustes → Conectores → LinkedIn, que aparece cuando LinkedIn está conectado en Composio. **Nada se publica sin tu aprobación, y nunca más de un post al día.**

- **Tu voz** (`li:voice`): cómo escribes, qué defiendes, qué no tocas y qué pruebas reales puedes usar. La leen quienes escriben por ti: marketing, el equipo de Crecimiento y quien tenga «LinkedIn», «redes» o «copy» en el puesto. Se puede escribir sola a partir de dos o tres posts tuyos.
- **Humanizador** (`server/humanizer.ts`, sin dependencias, todo en local):
  - **Limpia:** caracteres invisibles, rayas, comillas curvas, «…» y las muletillas de IA (léxico en español en `server/data/slop.es.json` y en inglés en `slop.en.json`; se pueden editar).
  - **Marca para reescribir:** «No es solo X, es Y», tríos, preguntas cebo, muros de hashtags, emojis de cohete y frases de largo uniforme.
  - **Puntúa de 0 a 100 en cinco apartados:** variedad, concreción, muletillas, huella y voz. El apartado más flojo pesa un 40 %.
  - **Herramienta `humanizar`** para los agentes, y un probador en el panel.
- **Cada post a LinkedIn**, lo escriba quien lo escriba, pasa por el humanizador antes de llegar a ti.
  - Si suena a IA, o lleva cifras que no salen de tu voz, tus temas o el dossier, vuelve una vez a quien lo escribió.
  - En «Para ti» lo ves tal como saldrá, con su nota. **Puedes editarlo antes de aprobar**, y no se aprueba mientras queden huecos `{{tu cifra}}`.
- **Guía** (`guia_linkedin`):
  - 21 ganchos en español (`server/data/hooks.es.json`) y la forma de un post (gancho en la línea 1, párrafos cortos, 900-1.300 caracteres, sin enlaces en el cuerpo, como mucho tres hashtags, nada inventado);
  - el plan semanal;
  - cómo comentar en posts ajenos;
  - cómo sacar varios posts de un vídeo o documento;
  - la rúbrica de perfil sobre 100.
- **Plan semanal** (`server/linkedin.ts`), si lo activas: posts a la semana (4 recomendados), días, hora, quién lo lleva y tus temas.
  - Cada semana, con la oficina abierta, prepara el plan (tipo, gancho y ángulo por hueco, y a qué tipo de cuentas dedicar 20 minutos al día) y te lo cuenta en su chat.
  - Cada día que toca, la IA escribe solo el texto. El resto lo hace la oficina: humanizador, cifras inventadas convertidas en `{{tu cifra}}`, una reescritura si aún suena a IA, y el post a «Para ti».
  - El panel enseña cómo va cada post: planeado, esperando aprobación, publicado o descartado.
- **Lo que la API oficial no deja:** leer el feed, los comentarios, los mensajes o las estadísticas de tu perfil personal. Para comentar, responder o puntuar tu perfil, pégale el texto al agente en su chat.

## Aprendizaje

- **Memoria personal** de cada agente: lo que ha aprendido, p. ej. "a Adrián no le gustan los informes largos".
- **Memoria de empresa:** actas, decisiones, perfil del producto, guía de marca, errores y aciertos.
- **Reflexión diaria** al cerrar la oficina, con compactación semanal. La experiencia se acumula sin que crezca el contexto.

## IA

**Dónde se configura:** Ajustes → IA (lista de IA por prioridad, claves de Anthropic y Groq, dirección de Ollama, imágenes) y Ajustes → Conectores (tus apps de Composio y, como sección avanzada, la biblioteca de MCP reutilizable, con plantillas revisadas y versiones fijadas). La pestaña Conectores solo aparece cuando la clave de Composio está puesta en Ajustes → IA. Cada agente tiene en su ficha una sección IA: proveedor (el de Ajustes u otro), la clave de Ajustes de ese proveedor o una propia, un modelo, y los conectores que necesite (los elegirá él mismo cuando su IA funcione; tú puedes corregirlo).

- **Texto:** Claude por defecto; Groq (modelos abiertos muy rápidos, p. ej. GPT-OSS 120B) y Ollama en local como alternativas. Cada agente puede usar uno distinto.
- **Lista por prioridad:** en Ajustes → IA pones varias IA (proveedor + modelo) y las ordenas arrastrando (o con las flechas sobre el asa). Se piensa con la primera disponible. Si una llega a un límite (por minuto, del día o sin saldo) o falla (clave no válida, modelo retirado, sin respuesta), descansa un tiempo y la llamada pasa a la siguiente. Cuando se recupera, se vuelve a ella. Solo si están todas en pausa se detiene la oficina, y el panel dice cuándo vuelve la primera. En Groq, cada modelo tiene su propio cupo. Si un agente tiene su propia IA en la ficha, esa va delante de la lista.
- **Modo al grano (por defecto):** entre ellos y en sus notas hablan en estilo telegráfico (sin artículos, relleno ni cortesías, causa → efecto), y el dossier se guarda comprimido. Así gastan menos en lo que dicen y en todo lo que se relee después: historial, notas y dossier. Contigo, en reuniones, preguntas y respuestas a encargos, y en los entregables escriben con frases completas. Se cambia en Ajustes → IA → Gasto.
  - Sonnet para el trabajo, Opus para Dirección y las decisiones, Haiku para charla y paseos.
  - Configurable por agente.
- **Imagen:** Cloudflare Workers AI (gratis 10.000 neuronas al día). Calidades: Rápida (Flux 1 Schnell), Equilibrada (Flux 2 Klein 4B), Alta (Flux 2 Klein 9B) y Profesional (Leonardo Lucid Origin, unas 3 al día gratis).
  - En Ajustes → IA → Imágenes se ve el **saldo de hoy en tiempo real**: lo lee de la API de analíticas de Cloudflare (GraphQL, `aiInferenceAdaptiveGroups.sum.totalNeurons`) si el token tiene el permiso «Account Analytics: Read»; si no, usa la cuenta de la propia app.
  - **Gasto máximo al día** además de lo gratis (0 = nunca pasar del cupo): se comprueba **antes** de pedir cada imagen. Pasar del cupo gratis necesita el plan Workers Paid de Cloudflare (0,011 $ por 1.000 neuronas: unos 0,03 $ por imagen Profesional).
  - fal.ai y Recraft quedan como opciones.
- **Gasto:** tope diario en $. Al alcanzarlo, los agentes se van a casa.

## Conectores (MCP)

| Uso | Conector | Notas |
|---|---|---|
| Búsqueda | Exa o Tavily (oficiales) | capa gratuita |
| Leer webs | Firecrawl + Fetch (oficiales) | |
| X | xdevplatform/xmcp (oficial) | pago por uso: $0.015 por post, **$0.20 si lleva enlace**; limitar herramientas con `X_API_TOOL_ALLOWLIST` |
| Reddit | jordanburke/reddit-mcp-server (API oficial) | las apps nuevas de Reddit requieren aprobación manual (2–4 semanas) |
| LinkedIn | **MCP propio**, API oficial | publicar como tú (autoservicio). Página de empresa con la Community Management API (requiere aprobación). Leer el feed o perfiles ajenos **no existe** en la API oficial. |
| Pinterest | **MCP propio**, API v5 oficial | tableros y pines: leer y crear |
| Instagram / Threads | mikusnuz/meta-mcp (Graph API) | revisar el código antes de darle tokens |
| Analítica | GA4 (oficial Google), mcp-gsc, YouTube Data API | |
| Tendencias | MCP propio: Hacker News + RSS | |

**Descartados:**
- **stickerdaniel/linkedin-mcp-server:** el código está limpio, pero controla tu sesión del navegador (lee las cookies de Chrome vía Keychain). LinkedIn lo prohíbe y banea cuentas.
- **collactivelabs/pinterest-mcp-server:** abandonado, el modo stdio está roto y `npm start` expone tus tokens sin autenticación a la red local.
- **Dribbble, Behance y Google Trends:** sin API usable; solo se puede hacer scraping.

**Cómo funcionan** (`server/mcpHost.ts`, SDK oficial de MCP):
- Cada conector arranca la primera vez que lo necesita un agente que lo tiene marcado, y se cierra tras 15 minutos sin uso.
- Un programa local recibe un entorno mínimo (lo básico del sistema más sus propias claves de la bóveda), nunca el del servidor.
- «Probar», en Ajustes → Conectores → Servidores MCP, lo arranca y dice cuántas herramientas trae o por qué falla.

**Reglas:**
- Cada agente solo ve los conectores marcados en su ficha (IA).
- **Toda acción de escritura hacia fuera** (publicar, seguir, escribir a alguien) pasa por la cola de aprobación, salvo que la marques como automática.
- Lo leído de la web o de las redes se trata como no confiable (prompt injection).

## Apps (Composio)

**Ajustes → Conectores** conecta las apps del propietario a través de [Composio](https://platform.composio.dev): más de 1000 (Gmail, Slack, Notion, Drive, GitHub, Instagram, LinkedIn…). Así se aplica la skill `connect` de [awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills).

**Dos tipos de clave** (se pone en Ajustes → IA; la pestaña Conectores solo aparece con ella):
- **`ck_…`, Composio Connect** (Settings → Sessions & API Key): la cuenta normal de Composio. No tiene SDK; la oficina habla MCP con `connect.composio.dev/mcp` (`server/composioConnect.ts`) y la clave viaja solo en la cabecera `x-consumer-api-key`, sin seguir redirecciones. Conectas en el panel o en la web de Composio; los dos lugares ven lo mismo. Como Connect no lista su catálogo, el panel muestra las más usadas y deja conectar cualquier otra por su id.
- **`ak_…`, proyecto de desarrollador** (platform.composio.dev → Settings → Project Settings → API Keys): SDK `@composio/core`, con el catálogo completo.

**Qué se guarda y dónde:**
- La clave de Composio va a la bóveda (`composio_api_key`).
- Con clave de proyecto, un identificador anónimo (`oficina-…`) te representa ante Composio; nunca se usan tu nombre ni tu correo.
- El acceso a cada app (OAuth) lo guarda Composio en tu cuenta de Composio. Quien copie la oficina no se lleva ninguno.

**Conectar:** cada app abre su propia página para dar permiso; el panel espera hasta que queda conectada.

**Permiso por app:**

| Permiso | Qué pueden hacer |
|---|---|
| Solo leer | consultar, nunca escribir |
| Escribir con tu permiso (por defecto) | lo que escriban te llega a «Para ti» para aprobar o descartar |
| Escribir sin preguntar | actúan solos |

**Herramientas de los agentes:** el mismo patrón que las skills de Composio. Los agentes hacen `ver_apps` → `buscar_accion` (la acción y sus datos actuales, nunca de memoria) → `usar_accion`.
- Leer va directo.
- Escribir sigue el permiso de esa app.
- Durante 30 minutos después de leer algo de fuera (una web, una app), cualquier escritura pide tu aprobación aunque la app esté en «sin preguntar».
- Todo resultado se trata como datos y pasa por la redacción de la bóveda.

**Webs:** `leer_web` lee directo. Si la página solo se ve con JavaScript, la abre [agent-browser](https://github.com/vercel-labs/agent-browser) en una sesión desechable limitada al dominio de esa web, que se cierra al terminar. Las webs que el propietario pega en reuniones o encargos se leen antes de responder y quedan en el dossier.

## Chat con un agente

- **Si está hablando con un compañero**, al pulsarlo ves su conversación como un grupo, en directo, y puedes escribir: los dos te leen, te contestan primero y siguen teniéndolo en cuenta (la conversación dura un poco más cada vez que intervienes). «Chat con…» vuelve a vuestro chat privado.
- **Si está trabajando en su mesa**, en su chat ves en directo en qué tarea está, los pasos que lleva y el que está dando. Al terminar, ese rato queda plegado («Trabajó en «…» · 3 pasos · 6 min»): al abrirlo ves lo que pensó e hizo, con párrafos, listas y negritas. Si le escribes, lo tiene en cuenta.
- **Si tiene una tarea en pausa**, arriba de su chat ves qué tarea es y qué le falta. Su duda te llega en el momento a su chat (y a «Para ti»): al contestarle ahí, retoma el trabajo.
- **La ✕ del chat** (o Esc) lo cierra y deselecciona al personaje.
- **Mientras contesta** se ve qué hace («Consultando Pinterest», «Leyendo ejemplo.com»), con el logo de la app y las imágenes que está mirando. Al terminar, los pasos quedan plegados en una línea encima de su respuesta.
- **Tú le envías** imágenes y documentos (botón del clip, arrastrar o pegar): PNG, JPG, WebP, GIF, PDF, texto, Markdown, CSV, JSON, Word, Excel y PowerPoint, hasta 20 MB. Los documentos los lee (el servidor saca su texto: `unpdf` para PDF, el XML de Office con `fflate`). Las imágenes las ve si su IA ve (Claude, Qwen 3.5+, Kimi K2.5+…); si no, se usa Qwen 3.8 de Groq o Kimi K3 de NVIDIA con tu clave para esa respuesta. Las imágenes muy grandes se reducen antes de enviarlas.
- **Te envía** (herramienta `enviar`) imágenes que le haya devuelto una herramienta en esa conversación, nunca direcciones inventadas, y documentos que redacta (Markdown, CSV o texto). Las imágenes se amplían en el chat y llevan a su página original.
- **Dónde se guardan** (`server/files.ts`): en la carpeta de datos (`files/`, permisos 700), fuera del proyecto. Se comprueba el tipo real por su contenido; HTML, SVG y ejecutables no entran. Se sirven solo con el token de la sesión: imágenes y PDF se muestran, lo demás se descarga, nunca se ejecuta.

## Seguridad y datos

**Datos fuera del proyecto.** Viven en el directorio de datos de tu usuario:
- `~/Library/Application Support/Oficina3D` en macOS;
- `%APPDATA%\Oficina3D` en Windows;
- `~/.local/share/Oficina3D` en Linux.

Compartir el código o un build no arrastra nada.

**Bóveda cifrada** (`vault.enc`, AES-256-GCM):
- La clave vive en el llavero del sistema. Una copia del archivo no sirve en otra cuenta ni en otra máquina.
- Sin llavero, se usa una frase de paso (`OFICINA_PASSPHRASE`).

**El navegador nunca lee secretos.** Puede guardarlos y borrarlos, pero solo ve el nombre y los últimos 4 caracteres.

**Servidor local blindado:**
- solo escucha en `127.0.0.1`;
- comprueba `Host` (contra DNS rebinding) y `Origin` (contra otras webs abiertas en el navegador);
- pide un token por arranque para cualquier cambio.

**La configuración guarda referencias, no valores** (`${secret:nombre}`). Cada MCP recibe solo sus propias claves.

**Build limpio:** `npm run build` falla si encuentra algo con forma de clave en `dist/`.

## Tu proyecto real (oficina-link)

Ajustes → Proyecto conecta el proyecto para el que trabaja la oficina: en este ordenador, en un servidor por SSH (sin puertos abiertos) o por HTTPS (token del que el servidor solo guarda el hash). El enlace es un solo archivo sin dependencias (`link/oficina-link.mjs`, MCP por stdio o HTTP) y es lo único que toca el proyecto.

- **Doble llave:** el proyecto decide qué comparte en `oficina.link.json`; tú solo puedes recortarlo. La oficina fija el hash del manifiesto: si cambia, todo se para hasta que lo apruebes otra vez (y la escritura vuelve a apagada).
- **Lectura** (por defecto): estructura, archivos, búsqueda, git de solo lectura, cambios en vivo y fuentes de datos (`oficina.sources.mjs`: funciones de lectura que el proyecto publica, nunca SQL libre).
- **Siempre bloqueado:** `.env`, claves, `.git`, `node_modules`, credenciales, bases de datos, enlaces simbólicos y lo ignorado por git. Los secretos salen tachados.
- **Escritura** (no recomendada): «Proponer» → llega a «Para ti» con la diferencia y se aplica al aprobar; «Directo» exige escribir el nombre del proyecto. Solo Dirección, Desarrollo, Diseño y Marketing. Nunca package.json, lockfiles, CI, configs de build ni scripts; nunca comandos ni git. Cada cambio se puede deshacer.

**Límite:** un MCP de terceros malicioso puede robar su propio token. Por eso solo se usan conectores revisados, con versiones fijadas y permisos mínimos.

## Fases

1. ✅ **Base:** servidor local, bóveda cifrada, SQLite, reloj real, interruptores, sol real.
2. **Organización:** ✅ sin datos simulados, cuatro puestos fijos, altas y bajas, organigrama, recepción con puerta (entradas y salidas escalonadas, cada uno por su camino), bienvenida con Entrevistas, despacho de Dirección, mesas por colocar, luz de techo al anochecer, Ajustes de IA y biblioteca de conectores. Pendiente: salas de equipo, paseo del supervisor, reuniones por jerarquía.
3. **Agentes con IA (en marcha):** ✅ conversaciones reales y simultáneas con herramientas (equipo, tareas, notas, leer webs), bocadillos y enlace en 3D, pestaña Conversaciones (exportar y borrar), encargos al Organizador en texto libre, mensajes a cada agente (lo habla con el Organizador), dudas que pausan la tarea y suben al superior, cola de tareas por persona, tareas continuas (sin final ni %, van a la par de la cola, con una entrega cada rato, hasta que tú las paras), trabajo real en la mesa con avances, reunión inicial y reuniones contigo, en las que habla una persona por turno y deciden entre ellos quién responde; lo que aclaras entra en el dossier en el momento, así que la salud sube mientras hablas (dossier del producto y acta), salud del proyecto (claridad, foco, orden, avance, bloqueos) con crisis por debajo del 45 %, límites del proveedor respetados (cupo por minuto y diario). calendario (objeto de pared en 3D que pinta el mes, ventana con mes y día, «Próximo» en la barra de arriba; el Organizador te avisa sin gastar tokens el día antes, esa mañana y una hora antes, y los agentes pueden agendar), bandeja «Para ti» con todo lo que te dicen a ti (recordatorios, preguntas, respuestas a encargos, reuniones de crisis y propuestas de contratación con botón «Contratar»), con avisos flotantes abajo a la izquierda; la actividad pasa a un botón dentro de Equipo. Pendiente: conectores MCP en el bucle de trabajo, reflexión diaria.
4. **Reuniones reales y aprendizaje:** actas, memorias, reflexión diaria, entrevista inicial.
5. **Conectores:** anfitrión MCP, Ajustes → Conectores, cola de aprobación.
6. **MCP propios e imagen:** Pinterest, LinkedIn, HN/RSS, fal.ai y Recraft.
