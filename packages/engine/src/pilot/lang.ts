// Tasks written in another language than the code ("arreglar el reintento cuando
// expira el tiempo" for code that says retry / timeout). No models, no network:
// a dictionary of the words programmers use, with accents and inflections folded.
// A task term keeps its own spelling (code may be written in Spanish too) and gains
// its English equivalents as alternatives.

/** Spanish stem → English terms as they appear in identifiers (already split, lower case). */
const ES_EN_WORDS: Record<string, string[]> = {
  // actions
  anadir: ["add"], agregar: ["add"], crear: ["create"], borrar: ["delete", "remove"], eliminar: ["delete", "remove"],
  quitar: ["remove"], cambiar: ["change", "update"], actualizar: ["update", "upgrade"], arreglar: ["fix"],
  corregir: ["fix"], reparar: ["fix"], mejorar: ["improve"], simplificar: ["simplify"], refactorizar: ["refactor"],
  renombrar: ["rename"], mover: ["move"], copiar: ["copy"], clonar: ["clone"], fusionar: ["merge"], mezclar: ["merge"],
  combinar: ["merge", "combine"], dividir: ["split"], separar: ["split", "separate"], unir: ["join"],
  comparar: ["compare"], ordenar: ["sort"], filtrar: ["filter"], buscar: ["search", "find"], busqueda: ["search"],
  encontrar: ["find"], reemplazar: ["replace"], sustituir: ["replace"], comprobar: ["check"], verificar: ["verify", "check"],
  validar: ["validate"], validacion: ["validation", "validate"], probar: ["test"], prueba: ["test"],
  test: ["test"], ejecutar: ["run", "exec"], lanzar: ["throw", "launch"], arrancar: ["start"], iniciar: ["start", "init"],
  inicializar: ["init", "initialize"], parar: ["stop"], detener: ["stop"], terminar: ["finish", "end"], cerrar: ["close"],
  abrir: ["open"], leer: ["read"], escribir: ["write"], guardar: ["save", "store"], almacenar: ["store"], cargar: ["load"],
  descargar: ["download"], descarga: ["download"], subir: ["upload", "bump"], subida: ["upload"], enviar: ["send"],
  recibir: ["receive"], devolver: ["return"], retornar: ["return"], llamar: ["call"], llamada: ["call"],
  invocar: ["invoke", "call"], manejar: ["handle"], gestionar: ["handle", "manage"], gestion: ["handling", "management"],
  procesar: ["process"], procesado: ["process", "processing"], analizar: ["parse", "analyze"], parsear: ["parse"],
  convertir: ["convert"], transformar: ["transform"], formatear: ["format"], codificar: ["encode"], decodificar: ["decode"],
  decodificacion: ["decode", "decoding"], codificacion: ["encoding", "encode"], serializar: ["serialize"],
  deserializar: ["deserialize"], comprimir: ["compress"], comprimido: ["compressed", "compress"], cifrar: ["encrypt"],
  descifrar: ["decrypt"], firmar: ["sign"], autenticar: ["auth", "authenticate"], autorizar: ["authorize", "auth"],
  registrar: ["log", "register"], depurar: ["debug"], compilar: ["build", "compile"], construir: ["build"],
  desplegar: ["deploy"], publicar: ["publish", "release"], instalar: ["install"], desinstalar: ["uninstall"],
  configurar: ["config", "configure"], reintentar: ["retry"], reintento: ["retry"], abortar: ["abort"],
  cancelar: ["cancel", "abort"], cancelacion: ["cancel", "cancellation", "abort"], esperar: ["wait", "await"],
  escuchar: ["listen"], emitir: ["emit"], notificar: ["notify"], avisar: ["warn", "notify"], mostrar: ["show", "display", "render"],
  pintar: ["render", "draw", "paint"], renderizar: ["render"], dibujar: ["draw"], ocultar: ["hide"], conservar: ["preserve", "keep"],
  mantener: ["keep", "preserve"], preservar: ["preserve"], respetar: ["respect", "honor"], ignorar: ["ignore"],
  saltar: ["skip"], omitir: ["skip", "omit"], permitir: ["allow"], rechazar: ["reject"], aceptar: ["accept"],
  admitir: ["accept", "support"], soportar: ["support"], evitar: ["avoid", "prevent"], impedir: ["prevent"],
  limpiar: ["clean", "clear"], vaciar: ["clear", "empty"], reiniciar: ["reset", "restart"], restablecer: ["reset"],
  restaurar: ["restore"], recuperar: ["recover", "restore"], liberar: ["release", "free"], aplicar: ["apply", "enforce"],
  heredar: ["inherit"], extender: ["extend"], ampliar: ["extend", "expand"], envolver: ["wrap"], envoltorio: ["wrapper", "wrap"],
  aislar: ["isolate"], reforzar: ["harden"], normalizar: ["normalize"], propagar: ["propagate"], propagacion: ["propagation", "spread"],
  reconocer: ["recognize", "detect"], detectar: ["detect"], medir: ["measure"], contar: ["count"], calcular: ["compute", "calculate"],
  documentar: ["doc", "docs", "document"], documentacion: ["docs", "doc", "documentation"], traducir: ["translate"],
  importar: ["import"], exportar: ["export"], tipar: ["type", "types"],
  // things
  error: ["error", "err"], fallo: ["failure", "error", "bug"], excepcion: ["exception", "error"], aviso: ["warning", "warn"],
  advertencia: ["warning", "warn"], peticion: ["request", "req"], solicitud: ["request", "req"], respuesta: ["response", "res"],
  cuerpo: ["body"], cabecera: ["header", "headers"], encabezado: ["header", "headers"], cabecero: ["header"],
  ruta: ["route", "path"], enrutador: ["router"], enrutamiento: ["routing", "router"], direccion: ["address", "url"],
  enlace: ["link"], redireccion: ["redirect"], redirigir: ["redirect"], dominio: ["domain"], puerto: ["port"],
  servidor: ["server"], cliente: ["client"], conexion: ["connection", "socket"], tiempo: ["time", "timeout"],
  espera: ["wait", "timeout"], temporizador: ["timer"], intervalo: ["interval"], retraso: ["delay"], demora: ["delay"],
  plazo: ["timeout", "deadline"], limite: ["limit", "max"], maximo: ["max"], minimo: ["min"], tamano: ["size"],
  longitud: ["length"], total: ["total"], progreso: ["progress"], senal: ["signal"], evento: ["event"], gancho: ["hook"],
  manejador: ["handler"], oyente: ["listener"], callback: ["callback"], promesa: ["promise"], tarea: ["task", "job"],
  trabajo: ["job", "work"], cola: ["queue"], hilo: ["thread"], proceso: ["process"], flujo: ["stream", "flow"],
  bufer: ["buffer"], memoria: ["memory"], cache: ["cache"], almacen: ["store"], estado: ["state", "status"],
  contexto: ["context"], sesion: ["session"], galleta: ["cookie"], usuario: ["user"], contrasena: ["password"],
  permiso: ["permission"], autenticacion: ["auth", "authentication"], token: ["token"], clave: ["key"], valor: ["value"],
  opcion: ["option", "options"], ajuste: ["setting", "settings"], configuracion: ["config", "configuration", "settings"],
  parametro: ["param", "params", "parameter"], argumento: ["arg", "args", "argument"], entrada: ["input", "entry"],
  salida: ["output"], resultado: ["result"], dato: ["data"], datos: ["data"], tipo: ["type", "types"], cadena: ["string", "str"],
  texto: ["text", "string"], numero: ["number", "num"], numerico: ["numeric", "number"], entero: ["int", "integer"],
  fecha: ["date"], hora: ["time", "hour"], marca: ["mark", "marker", "brand"], lista: ["list"], arreglo: ["array"],
  matriz: ["array", "matrix"], tupla: ["tuple"], objeto: ["object", "obj"], clase: ["class"], instancia: ["instance"],
  funcion: ["function", "func", "fn"], metodo: ["method"], propiedad: ["property", "prop", "props"], atributo: ["attribute", "attr"],
  campo: ["field"], variable: ["var", "variable"], constante: ["const", "constant"], modulo: ["module"], paquete: ["package"],
  dependencia: ["dependency", "deps", "dep"], biblioteca: ["library", "lib"], libreria: ["library", "lib"],
  version: ["version"], esquema: ["schema"], modelo: ["model"], tabla: ["table"], columna: ["column"], fila: ["row"],
  consulta: ["query"], indice: ["index"], base: ["base", "db"], migracion: ["migration", "migrate"], registro: ["log", "record", "registry"],
  pila: ["stack"], arbol: ["tree"], nodo: ["node"], grafo: ["graph"], raiz: ["root"], padre: ["parent"], hijo: ["child", "children"],
  fichero: ["file"], carpeta: ["folder", "dir"], directorio: ["dir", "directory"], plantilla: ["template"], vista: ["view"],
  pantalla: ["screen"], pagina: ["page"], paginacion: ["pagination", "page"], componente: ["component"], boton: ["button"],
  formulario: ["form"], imagen: ["image", "img"], icono: ["icon"], estilo: ["style", "styles"], tema: ["theme"],
  fuente: ["font", "source"], idioma: ["locale", "lang", "language"], traduccion: ["translation", "i18n"], mensaje: ["message", "msg"],
  correo: ["email", "mail"], notificacion: ["notification"], prototipo: ["prototype"], comprobacion: ["check"],
  cobertura: ["coverage"], unitario: ["unit"], navegador: ["browser"], codigo: ["code"], seguridad: ["security"],
  parche: ["patch"], lanzamiento: ["release"], rama: ["branch"], historial: ["history"], cambio: ["change"],
  conflicto: ["conflict"], repositorio: ["repo", "repository"], comentario: ["comment"], ejemplo: ["example"],
  utilidad: ["util", "utils"], ayudante: ["helper"], predicado: ["predicate"], mascota: ["pet"], juego: ["game"],
  puntuacion: ["score"], nivel: ["level"], mapa: ["map"], medio: ["media"], atajo: ["shortcut"],
  inmutable: ["immutable"], mutable: ["mutable"], vacio: ["empty"], nulo: ["null"], falso: ["false"], verdadero: ["true"],
  defecto: ["default", "defaults"], predeterminado: ["default"], personalizado: ["custom"], obsoleto: ["deprecated", "stale"],
  obsolescencia: ["deprecation", "deprecate"], duplicado: ["duplicate"], invalido: ["invalid"], valido: ["valid"],
  desconocido: ["unknown"], abierto: ["open"], cerrado: ["closed"], anidado: ["nested"], profundo: ["deep"],
  sincrono: ["sync"], asincrono: ["async"], global: ["global"], local: ["local"], estandar: ["standard", "std"],
  mayuscula: ["upper", "uppercase", "case"], minuscula: ["lower", "lowercase", "case"],
};

// A Map, not the object: "constructor" or "toString" must not hit Object.prototype
const ES_EN = new Map(Object.entries(ES_EN_WORDS));

/** Strip accents: "petición" → "peticion". Code identifiers never carry them. */
export function fold(word: string): string {
  return word.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Inflections tried in order: plural, verb forms, participles, diminutives…
const SUFFIXES: [RegExp, string][] = [
  [/ciones$/, "cion"],
  [/iones$/, "ion"],
  [/ces$/, "z"],
  [/(r|l|n|d)es$/, "$1"],
  [/s$/, ""],
  [/(ar|er|ir)(lo|la|los|las|le|les|se)$/, "$1"],
  [/(ando|iendo)$/, "ar"],
  [/(ado|ada|ados|adas)$/, "ar"],
  [/(ido|ida|idos|idas)$/, "ir"],
  [/(ido|ida|idos|idas)$/, "er"],
  [/(a|e|o|an|en|amos|emos|imos|as|es)$/, "ar"],
  [/(a|e|o|an|en|as|es)$/, "er"],
  [/(a|e|o|an|en|as|es)$/, "ir"],
  [/(a|o)$/, ""],
];

/** English equivalents of a (lower-case) task term, or [] when it isn't a known Spanish word. */
export function translateTerm(term: string): string[] {
  const t = fold(term);
  const direct = ES_EN.get(t);
  if (direct) return direct;
  for (const [re, rep] of SUFFIXES) {
    if (!re.test(t)) continue;
    const stem = t.replace(re, rep);
    const found = stem.length >= 3 ? ES_EN.get(stem) : undefined;
    if (found) return found;
  }
  return [];
}

/** A task term and what it may be called in the code: itself (accents folded) plus translations. */
export function alternatives(term: string): string[] {
  const folded = fold(term);
  return [...new Set([folded, ...translateTerm(term)])];
}
