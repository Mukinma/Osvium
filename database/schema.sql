PRAGMA foreign_keys = ON;

-- =========================
-- 1. Tabla usuarios
-- =========================

CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    activo INTEGER NOT NULL DEFAULT 1 CHECK(activo IN (0,1)),
    fecha_registro DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    creado_por_admin_id INTEGER NULL
);

-- =========================
-- 2. Tabla muestras
-- =========================

CREATE TABLE IF NOT EXISTS muestras (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL,
    imagen_ref TEXT NOT NULL,
    pose_type TEXT NOT NULL DEFAULT 'frontal',
    preprocess_mode TEXT NOT NULL DEFAULT 'legacy_bbox',
    fecha_captura DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
);

-- =========================
-- 3. Tabla accesos
-- =========================

CREATE TABLE IF NOT EXISTS accesos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER,
    confianza REAL,
    fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resultado TEXT NOT NULL CHECK(resultado IN ('AUTORIZADO','DENEGADO','DESCONOCIDO','ERROR','MANUAL','DENEGADO_BLOQUEO')),
    motivo TEXT,
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
);

-- =========================
-- 4. Tabla configuracion
-- =========================

CREATE TABLE IF NOT EXISTS configuracion (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    umbral_confianza REAL NOT NULL,
    tiempo_apertura_seg INTEGER NOT NULL,
    max_intentos INTEGER NOT NULL,
    support_phone TEXT NOT NULL DEFAULT '',
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Insertar configuración por defecto si no existe
INSERT OR IGNORE INTO configuracion (id, umbral_confianza, tiempo_apertura_seg, max_intentos, support_phone)
VALUES (1, 60.0, 5, 3, '');

-- =========================
-- 5. Tabla administradores
-- =========================

CREATE TABLE IF NOT EXISTS administradores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    rol TEXT NOT NULL CHECK(rol IN ('CEO','ENCARGADO','OPERADOR')),
    activo INTEGER NOT NULL DEFAULT 1 CHECK(activo IN (0,1)),
    fecha_creacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_admin_rol ON administradores(rol);
CREATE INDEX IF NOT EXISTS idx_admin_activo ON administradores(activo);

-- =========================
-- 6. Tabla model_meta
-- =========================

CREATE TABLE IF NOT EXISTS model_meta (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    trained_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    samples INTEGER NOT NULL DEFAULT 0,
    unique_users INTEGER NOT NULL DEFAULT 0
);

-- =========================
-- 7. Índices de rendimiento
-- =========================

CREATE INDEX IF NOT EXISTS idx_accesos_fecha ON accesos(fecha);
CREATE INDEX IF NOT EXISTS idx_accesos_usuario ON accesos(usuario_id);
CREATE INDEX IF NOT EXISTS idx_muestras_usuario ON muestras(usuario_id);
CREATE INDEX IF NOT EXISTS idx_muestras_pose ON muestras(pose_type);
CREATE INDEX IF NOT EXISTS idx_muestras_preprocess ON muestras(preprocess_mode);

-- =========================
-- 7. Vista de auditoría administrativa
-- =========================

CREATE VIEW IF NOT EXISTS vista_usuarios_con_admin AS
SELECT
    u.id,
    u.nombre,
    u.activo,
    u.fecha_registro,
    a.username AS creado_por
FROM usuarios u
LEFT JOIN administradores a
    ON u.creado_por_admin_id = a.id;
