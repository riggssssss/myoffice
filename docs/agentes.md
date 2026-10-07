# Agentes de la oficina

Cada trabajador de la oficina 3D pasa a ser un agente con un rol real. Este documento es el
punto de partida: lista los agentes, qué hacen y qué herramientas necesitan. Lo iremos
profundizando agente a agente (skills, permisos, flujos).

Todo es local: la app, la base de datos y el registro de lo que hace cada agente.

## Agentes

### 1. Diseño (creativo)
Crea y cuida todo lo visual.
- Genera imágenes y piezas para redes, web y anuncios (API externa de imagen).
- Busca tendencias visuales: Pinterest, Dribbble, Behance, cuentas de referencia.
- Monta moodboards y mantiene la identidad de marca (colores, tipografías, estilo).
- Entrega piezas listas al agente de Marketing.

Herramientas: API de generación de imagen · MCP/API de Pinterest · búsqueda web · carpeta local de assets.

### 2. Marketing
Da a conocer el producto y consigue clientes.
- Plan de contenidos y calendario; redacta los textos.
- Publica y programa en X, LinkedIn, Reddit, Instagram…
- Sigue cuentas, responde, participa en conversaciones relevantes.
- Prospección: busca perfiles y empresas que encajen (clientes potenciales).
- Mide resultados y ajusta.

Herramientas: MCP de X, LinkedIn y Reddit · búsqueda web · CRM local de leads.

### 3. Product designer
Decide qué construir y cómo se usa.
- Flujos, wireframes y especificaciones de pantallas.
- Convierte el feedback (de Atención al cliente y Revisor) en mejoras priorizadas.
- Revisa la experiencia del producto en vivo.

Herramientas: acceso de lectura al proyecto · tablero de tareas local.

### 4. Revisor (observador del proyecto en vivo)
Ve el estado real del producto en todo momento, **solo lectura**.
- Estado del servicio, errores, rendimiento.
- Detecta usuarios con problemas («tal usuario falla en el pago desde ayer»).
- Avisa a quien corresponda y deja informes.

Herramientas: MCP propio del proyecto, de solo lectura (ver abajo).

### 5. Atención al cliente
Atiende a los usuarios desde la web.
- Chat en la web conectado al agente.
- Responde con la base de conocimiento; escala a una persona cuando no sabe.
- Registra cada conversación e incidencia en la base de datos local.
- Pasa los problemas recurrentes al Product designer y al Revisor.

Herramientas: widget de chat · base de conocimiento · base de datos local (conversaciones, incidencias).

### Opcionales
- **Coordinador** (el PM actual): reparte trabajo entre agentes, hace la daily, resume el día.
- **Investigación** (el research actual): competencia, mercado, tendencias del sector.

## Piezas comunes

- **Base de datos local** (p. ej. SQLite): tareas, conversaciones, leads, publicaciones, informes, y el registro de cada acción de cada agente.
- **MCP del proyecto, solo lectura**: expone estado, errores, usuarios y métricas. Sin herramientas de escritura y con un usuario de base de datos que solo puede leer, así la seguridad no depende de que el agente se porte bien.
- **Cola de aprobación**: todo lo que sale fuera (publicar, seguir, escribir a alguien) espera un visto bueno, al menos al principio.
- **La oficina 3D como panel**: cada agente es su personaje; su estado, su tarea y su actividad se ven en vivo, como ahora con la simulación.

## Reparto inicial propuesto (a confirmar)

| Personaje | Agente |
|---|---|
| Pepe | Investigación |
| María | Diseño |
| Manuel | Product designer |
| Lucía | Revisor |
| Javier | Coordinador |
| Sara | Atención al cliente |

Marketing necesitaría un séptimo personaje o sustituir a uno de los opcionales.

## Por decidir cuando profundicemos
- API de imagen (y presupuesto).
- Cuentas y permisos de cada red social.
- Qué acciones necesitan aprobación y cuáles no.
- Stack del backend local y cómo se ejecutan los agentes.
