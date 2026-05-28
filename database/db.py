import sqlite3
import time
import logging
import re
from pathlib import Path
from typing import Any, Optional, Iterable

from config import config


logger = logging.getLogger("camerapi.db")
ACCESS_RESULTS_ALLOWED = {
    "AUTORIZADO",
    "DENEGADO",
    "DESCONOCIDO",
    "ERROR",
    "MANUAL",
    "DENEGADO_BLOQUEO",
}
APPEARANCE_VARIANTS_ALLOWED = {"normal", "cabello_recogido", "casco"}


class Database:
    def __init__(self, db_path: str = config.db_path, schema_path: str = "database/schema.sql"):
        self.db_path = str(db_path)
        self.schema_path = str(schema_path)
        self.max_retries = 3
        self.retry_delay_sec = 0.2

        db_file = Path(self.db_path)
        db_file.parent.mkdir(parents=True, exist_ok=True)

    def _apply_pragmas(self, conn: sqlite3.Connection) -> None:
        conn.row_factory = sqlite3.Row

        conn.execute("PRAGMA foreign_keys = ON;")
        conn.execute("PRAGMA journal_mode = WAL;")

        conn.execute("PRAGMA busy_timeout = 5000;")
        conn.execute("PRAGMA synchronous = NORMAL;")
        conn.execute("PRAGMA temp_store = MEMORY;")
        conn.execute("PRAGMA cache_size = -20000;")

        conn.execute("PRAGMA trusted_schema = OFF;")
        conn.execute("PRAGMA recursive_triggers = ON;")

    def connect(self) -> sqlite3.Connection:
        last_error: Optional[Exception] = None
        for attempt in range(1, self.max_retries + 1):
            try:
                conn = sqlite3.connect(
                    self.db_path,
                    check_same_thread=False,
                    timeout=10,
                )
                self._apply_pragmas(conn)
                return conn
            except sqlite3.Error as exc:
                last_error = exc
                logger.error("db_connect_failed attempt=%s error=%s", attempt, exc)
                time.sleep(self.retry_delay_sec)
        raise RuntimeError(f"No se pudo conectar a SQLite: {last_error}")

    def init_db(self, schema_path: Optional[str] = None) -> None:
        schema_path = schema_path or self.schema_path

        schema_file = Path(schema_path).resolve()
        if not schema_file.is_file():
            raise FileNotFoundError(f"Schema no encontrado: {schema_file}")

        try:
            sql = schema_file.read_text(encoding="utf-8")
        except Exception as exc:
            raise RuntimeError(f"No se pudo leer schema: {schema_file}") from exc

        try:
            with self.connect() as conn:
                sql_to_execute = sql

                usuarios_cols = {
                    row["name"]
                    for row in conn.execute("PRAGMA table_info(usuarios);").fetchall()
                }
                if "creado_por_admin_id" in usuarios_cols:
                    sql_to_execute = re.sub(
                        r"ALTER\s+TABLE\s+usuarios\s+ADD\s+COLUMN\s+creado_por_admin_id\s+INTEGER\s+NULL\s*;",
                        "",
                        sql_to_execute,
                        flags=re.IGNORECASE,
                    )

                muestras_cols_before = {
                    row["name"]
                    for row in conn.execute("PRAGMA table_info(muestras);").fetchall()
                }
                has_pose_type_before = "pose_type" in muestras_cols_before
                if not has_pose_type_before:
                    sql_to_execute = re.sub(
                        r"CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_muestras_pose\s+ON\s+muestras\s*\(\s*pose_type\s*\)\s*;",
                        "",
                        sql_to_execute,
                        flags=re.IGNORECASE,
                    )
                has_preprocess_before = "preprocess_mode" in muestras_cols_before
                if not has_preprocess_before:
                    sql_to_execute = re.sub(
                        r"CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_muestras_preprocess\s+ON\s+muestras\s*\(\s*preprocess_mode\s*\)\s*;",
                        "",
                        sql_to_execute,
                        flags=re.IGNORECASE,
                    )
                has_appearance_before = "appearance_variant" in muestras_cols_before
                if not has_appearance_before:
                    sql_to_execute = re.sub(
                        r"CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_muestras_appearance\s+ON\s+muestras\s*\(\s*appearance_variant\s*\)\s*;",
                        "",
                        sql_to_execute,
                        flags=re.IGNORECASE,
                    )

                configuracion_cols_before = {
                    row["name"]
                    for row in conn.execute("PRAGMA table_info(configuracion);").fetchall()
                }
                if configuracion_cols_before and "support_phone" not in configuracion_cols_before:
                    sql_to_execute = re.sub(
                        r"INSERT\s+OR\s+IGNORE\s+INTO\s+configuracion\s*\(\s*id\s*,\s*umbral_confianza\s*,\s*tiempo_apertura_seg\s*,\s*max_intentos\s*,\s*support_phone\s*\)\s*VALUES\s*\(\s*1\s*,\s*60\.0\s*,\s*5\s*,\s*3\s*,\s*''\s*\)\s*;",
                        "INSERT OR IGNORE INTO configuracion (id, umbral_confianza, tiempo_apertura_seg, max_intentos) VALUES (1, 60.0, 5, 3);",
                        sql_to_execute,
                        flags=re.IGNORECASE,
                    )

                conn.executescript(sql_to_execute)

                # ── Migration: add pose_type column to muestras ──
                muestras_cols = {
                    row["name"]
                    for row in conn.execute("PRAGMA table_info(muestras);").fetchall()
                }
                if "pose_type" not in muestras_cols:
                    conn.execute(
                        "ALTER TABLE muestras ADD COLUMN pose_type TEXT DEFAULT 'frontal';"
                    )
                    logger.info("migration_applied added_column=pose_type table=muestras")
                if "preprocess_mode" not in muestras_cols:
                    conn.execute(
                        "ALTER TABLE muestras ADD COLUMN preprocess_mode TEXT NOT NULL DEFAULT 'legacy_bbox';"
                    )
                    logger.info("migration_applied added_column=preprocess_mode table=muestras")
                if "appearance_variant" not in muestras_cols:
                    conn.execute(
                        "ALTER TABLE muestras ADD COLUMN appearance_variant TEXT NOT NULL DEFAULT 'normal';"
                    )
                    logger.info("migration_applied added_column=appearance_variant table=muestras")

                conn.execute(
                    "CREATE INDEX IF NOT EXISTS idx_muestras_pose ON muestras(pose_type);"
                )
                conn.execute(
                    "CREATE INDEX IF NOT EXISTS idx_muestras_preprocess ON muestras(preprocess_mode);"
                )
                conn.execute(
                    "CREATE INDEX IF NOT EXISTS idx_muestras_appearance ON muestras(appearance_variant);"
                )

                configuracion_cols = {
                    row["name"]
                    for row in conn.execute("PRAGMA table_info(configuracion);").fetchall()
                }
                if "support_phone" not in configuracion_cols:
                    conn.execute(
                        "ALTER TABLE configuracion ADD COLUMN support_phone TEXT NOT NULL DEFAULT '';"
                    )
                    logger.info("migration_applied added_column=support_phone table=configuracion")
        except Exception:
            logger.exception("db_init_failed schema_path=%s", schema_file)
            raise

    def fetch_one(self, query: str, params: tuple = ()) -> Optional[sqlite3.Row]:
        try:
            with self.connect() as conn:
                return conn.execute(query, params).fetchone()
        except Exception:
            logger.exception("db_fetch_one_failed query=%s", query)
            raise

    def fetch_all(self, query: str, params: tuple = ()) -> list[sqlite3.Row]:
        try:
            with self.connect() as conn:
                return conn.execute(query, params).fetchall()
        except Exception:
            logger.exception("db_fetch_all_failed query=%s", query)
            raise

    def execute(self, query: str, params: tuple = ()) -> int:
        try:
            with self.connect() as conn:
                cur = conn.execute(query, params)
                return cur.lastrowid
        except Exception:
            logger.exception("db_execute_failed query=%s", query)
            raise

    def execute_many(self, query: str, params: Iterable[tuple]) -> int:
        params_list = list(params)
        if not params_list:
            return 0
        try:
            with self.connect() as conn:
                conn.executemany(query, params_list)
            return len(params_list)
        except Exception:
            logger.exception("db_execute_many_failed query=%s", query)
            raise

    def health_check(self) -> bool:
        try:
            row = self.fetch_one("SELECT 1 AS ok")
            return bool(row and row["ok"] == 1)
        except Exception:
            logger.exception("db_health_failed")
            return False

    def get_config(self) -> dict[str, Any]:
        row = self.fetch_one(
            "SELECT umbral_confianza, tiempo_apertura_seg, max_intentos, support_phone FROM configuracion WHERE id=1"
        )
        if not row:
            return {
                "umbral_confianza": float(config.default_confidence_threshold),
                "tiempo_apertura_seg": int(config.default_open_seconds),
                "max_intentos": int(config.default_max_attempts),
                "support_phone": "",
            }
        return dict(row)

    def update_config(
        self,
        umbral_confianza: float,
        tiempo_apertura_seg: int,
        max_intentos: int,
        support_phone: Optional[str] = None,
    ) -> None:
        if not (1.0 <= float(umbral_confianza) <= 200.0):
            raise ValueError("umbral_confianza fuera de rango 1..200")
        if not (1 <= int(tiempo_apertura_seg) <= 30):
            raise ValueError("tiempo_apertura_seg fuera de rango 1..30")
        if not (1 <= int(max_intentos) <= 10):
            raise ValueError("max_intentos fuera de rango 1..10")
        if support_phone is None:
            support_phone_norm = str(self.get_config().get("support_phone") or "")
        else:
            support_phone_norm = str(support_phone or "").strip()
        if len(support_phone_norm) > 64:
            raise ValueError("support_phone fuera de rango 0..64")
        if support_phone_norm and not re.match(r"^[0-9+().\-\s]+$", support_phone_norm):
            raise ValueError("support_phone contiene caracteres inválidos")

        self.execute(
            """
            UPDATE configuracion
            SET umbral_confianza=?, tiempo_apertura_seg=?, max_intentos=?, support_phone=?
            WHERE id=1
            """,
            (float(umbral_confianza), int(tiempo_apertura_seg), int(max_intentos), support_phone_norm),
        )

    def create_user(self, nombre: str, activo: bool = True) -> int:
        nombre_norm = (nombre or "").strip()
        if not nombre_norm:
            raise ValueError("nombre vacío")
        return self.execute(
            "INSERT INTO usuarios (nombre, activo) VALUES (?, ?)",
            (nombre_norm, 1 if activo else 0),
        )

    def set_user_status(self, user_id: int, active: bool) -> None:
        if int(user_id) <= 0:
            raise ValueError("user_id inválido")
        self.execute("UPDATE usuarios SET activo=? WHERE id=?", (1 if active else 0, int(user_id)))

    def delete_user(self, user_id: int) -> bool:
        if int(user_id) <= 0:
            raise ValueError("user_id inválido")
        user = self.get_user(user_id)
        if not user:
            return False
        try:
            with self.connect() as conn:
                conn.execute("DELETE FROM muestras WHERE usuario_id=?", (int(user_id),))
                conn.execute("UPDATE accesos SET usuario_id=NULL WHERE usuario_id=?", (int(user_id),))
                conn.execute("DELETE FROM usuarios WHERE id=?", (int(user_id),))
            return True
        except Exception:
            logger.exception("db_delete_user_failed user_id=%s", user_id)
            raise

    def list_users(self) -> list[dict[str, Any]]:
        rows = self.fetch_all(
            """
            SELECT
                u.id,
                u.nombre,
                u.activo,
                u.fecha_registro,
                COUNT(m.id) AS samples_count,
                MAX(m.fecha_captura) AS last_sample_at,
                (
                    SELECT a.fecha
                    FROM accesos a
                    WHERE a.usuario_id = u.id
                    ORDER BY a.id DESC
                    LIMIT 1
                ) AS last_access_at,
                (
                    SELECT a.resultado
                    FROM accesos a
                    WHERE a.usuario_id = u.id
                    ORDER BY a.id DESC
                    LIMIT 1
                ) AS last_access_result,
                (
                    SELECT mm.trained_at
                    FROM model_meta mm
                    WHERE mm.id = 1
                ) AS model_trained_at
            FROM usuarios u
            LEFT JOIN muestras m
                ON m.usuario_id = u.id
               AND m.preprocess_mode = ?
            GROUP BY u.id
            ORDER BY u.id DESC
            """,
            (config.sface_preprocess_mode,),
        )

        users: list[dict[str, Any]] = []
        for row in rows:
            user = dict(row)
            samples_count = int(user.get("samples_count") or 0)
            last_sample_at = user.get("last_sample_at")
            model_trained_at = user.pop("model_trained_at", None)
            user["samples_count"] = samples_count
            user["needs_training"] = (
                samples_count <= 0
                or not model_trained_at
                or (bool(last_sample_at) and str(last_sample_at) > str(model_trained_at))
            )
            user["thumbnail_url"] = f"/api/users/{user['id']}/thumbnail" if samples_count > 0 else None
            users.append(user)
        return users

    def get_user(self, user_id: int) -> Optional[dict[str, Any]]:
        if int(user_id) <= 0:
            raise ValueError("user_id inválido")
        row = self.fetch_one("SELECT id, nombre, activo FROM usuarios WHERE id=?", (int(user_id),))
        return dict(row) if row else None

    def get_user_thumbnail_path(self, user_id: int) -> Optional[str]:
        if int(user_id) <= 0:
            raise ValueError("user_id inválido")
        row = self.fetch_one(
            """
            SELECT imagen_ref
            FROM muestras
            WHERE usuario_id=?
              AND preprocess_mode=?
            ORDER BY id DESC
            LIMIT 1
            """,
            (int(user_id), config.sface_preprocess_mode),
        )
        return str(row["imagen_ref"]) if row else None

    def _normalize_imagen_ref(self, imagen_ref: str) -> str:
        ref = (imagen_ref or "").strip()
        if not ref:
            raise ValueError("imagen_ref vacío")

        p = Path(ref)
        if p.is_absolute() or ".." in p.parts:
            raise ValueError("imagen_ref inválido, no se permiten rutas absolutas ni traversal")

        allowed = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-/")
        if any(ch not in allowed for ch in ref):
            raise ValueError("imagen_ref contiene caracteres no permitidos")

        return ref

    def _normalize_preprocess_mode(self, preprocess_mode: Optional[str]) -> str:
        mode = (preprocess_mode or config.sface_preprocess_mode).strip().lower()
        valid_modes = {config.legacy_preprocess_mode, config.sface_preprocess_mode}
        if mode not in valid_modes:
            raise ValueError("preprocess_mode inválido")
        return mode

    def _normalize_appearance_variant(self, appearance_variant: Optional[str]) -> str:
        variant = (appearance_variant or "normal").strip().lower()
        if variant not in APPEARANCE_VARIANTS_ALLOWED:
            raise ValueError("appearance_variant inválido")
        return variant

    @staticmethod
    def _normalize_pose_type(pose_type: Optional[str]) -> str:
        valid_poses = {"frontal", "tilt_left", "tilt_right", "look_up", "look_down", "turn_left", "turn_right", "center"}
        pose = pose_type.strip().lower() if pose_type else "frontal"
        return pose if pose in valid_poses else "frontal"

    def insert_sample_with_pose(
        self,
        user_id: int,
        imagen_ref: str,
        pose_type: str,
        preprocess_mode: Optional[str] = None,
        appearance_variant: Optional[str] = None,
    ) -> int:
        if int(user_id) <= 0:
            raise ValueError("user_id inválido")
        imagen_ref_norm = self._normalize_imagen_ref(imagen_ref)
        pose = self._normalize_pose_type(pose_type)
        mode = self._normalize_preprocess_mode(preprocess_mode)
        variant = self._normalize_appearance_variant(appearance_variant)
        return self.execute(
            "INSERT INTO muestras (usuario_id, imagen_ref, pose_type, preprocess_mode, appearance_variant) VALUES (?, ?, ?, ?, ?)",
            (int(user_id), imagen_ref_norm, pose, mode, variant),
        )

    def insert_samples_with_pose(
        self,
        user_id: int,
        samples: Iterable[tuple],
        preprocess_mode: Optional[str] = None,
    ) -> int:
        if int(user_id) <= 0:
            raise ValueError("user_id inválido")
        mode = self._normalize_preprocess_mode(preprocess_mode)
        rows = []
        for sample in samples:
            if len(sample) == 2:
                imagen_ref, pose_type = sample
                appearance_variant = "normal"
            else:
                imagen_ref, pose_type, appearance_variant = sample[:3]
            imagen_ref_norm = self._normalize_imagen_ref(imagen_ref)
            pose = self._normalize_pose_type(pose_type)
            variant = self._normalize_appearance_variant(appearance_variant)
            rows.append((int(user_id), imagen_ref_norm, pose, mode, variant))
        return self.execute_many(
            "INSERT INTO muestras (usuario_id, imagen_ref, pose_type, preprocess_mode, appearance_variant) VALUES (?, ?, ?, ?, ?)",
            rows,
        )

    def insert_sample(
        self,
        user_id: int,
        imagen_ref: str,
        preprocess_mode: Optional[str] = None,
        appearance_variant: Optional[str] = None,
    ) -> int:
        if int(user_id) <= 0:
            raise ValueError("user_id inválido")
        imagen_ref_norm = self._normalize_imagen_ref(imagen_ref)
        mode = self._normalize_preprocess_mode(preprocess_mode)
        variant = self._normalize_appearance_variant(appearance_variant)
        return self.execute(
            "INSERT INTO muestras (usuario_id, imagen_ref, preprocess_mode, appearance_variant) VALUES (?, ?, ?, ?)",
            (int(user_id), imagen_ref_norm, mode, variant),
        )

    def list_samples(
        self,
        user_id: Optional[int] = None,
        preprocess_mode: Optional[str] = None,
    ) -> list[dict[str, Any]]:
        filters = []
        params: list[Any] = []
        if user_id is not None:
            if int(user_id) <= 0:
                raise ValueError("user_id inválido")
            filters.append("usuario_id=?")
            params.append(int(user_id))
        if preprocess_mode is not None:
            filters.append("preprocess_mode=?")
            params.append(self._normalize_preprocess_mode(preprocess_mode))
        where = f" WHERE {' AND '.join(filters)}" if filters else ""
        query = (
            "SELECT id, usuario_id, imagen_ref, pose_type, preprocess_mode, appearance_variant, fecha_captura "
            f"FROM muestras{where} ORDER BY id DESC"
        )
        rows = self.fetch_all(query, tuple(params))
        return [dict(row) for row in rows]

    def replace_user_face_samples(
        self,
        user_id: int,
        samples: Iterable[tuple],
        preprocess_mode: Optional[str] = None,
        dataset_dir: str = config.dataset_dir,
    ) -> dict[str, Any]:
        if int(user_id) <= 0:
            raise ValueError("user_id inválido")

        mode = self._normalize_preprocess_mode(preprocess_mode)
        rows = []
        new_refs: set[str] = set()
        for sample in samples:
            if len(sample) == 2:
                imagen_ref, pose_type = sample
                appearance_variant = "normal"
            else:
                imagen_ref, pose_type, appearance_variant = sample[:3]
            imagen_ref_norm = self._normalize_imagen_ref(imagen_ref)
            pose = self._normalize_pose_type(pose_type)
            variant = self._normalize_appearance_variant(appearance_variant)
            rows.append((int(user_id), imagen_ref_norm, pose, mode, variant))
            new_refs.add(imagen_ref_norm)

        if not rows:
            raise ValueError("samples vacío")

        old_refs: list[str] = []
        deleted_samples = 0
        try:
            with self.connect() as conn:
                old_rows = conn.execute(
                    "SELECT imagen_ref FROM muestras WHERE usuario_id=?",
                    (int(user_id),),
                ).fetchall()
                old_refs = [str(row["imagen_ref"]) for row in old_rows]
                cur = conn.execute("DELETE FROM muestras WHERE usuario_id=?", (int(user_id),))
                deleted_samples = int(cur.rowcount if cur.rowcount is not None else 0)
                conn.executemany(
                    "INSERT INTO muestras (usuario_id, imagen_ref, pose_type, preprocess_mode, appearance_variant) VALUES (?, ?, ?, ?, ?)",
                    rows,
                )
        except Exception:
            logger.exception("db_replace_user_face_samples_failed user_id=%s", user_id)
            raise

        deleted_files = 0
        root = Path(dataset_dir).resolve()
        for ref in old_refs:
            if ref in new_refs:
                continue
            path = Path(ref)
            if not path.is_absolute():
                path = root.parent / path
            try:
                resolved = path.resolve()
                if root in resolved.parents and resolved.is_file():
                    resolved.unlink()
                    deleted_files += 1
            except OSError:
                logger.warning("replace_user_face_sample_file_failed path=%s", ref)

        return {
            "ok": True,
            "deleted_samples": deleted_samples,
            "inserted_samples": len(rows),
            "deleted_files": deleted_files,
        }

    def purge_face_samples(self, dataset_dir: str = config.dataset_dir, model_path: str = config.model_path) -> dict[str, Any]:
        rows = self.fetch_all("SELECT imagen_ref FROM muestras")
        deleted_files = 0
        root = Path(dataset_dir).resolve()
        for row in rows:
            ref = str(row["imagen_ref"])
            path = Path(ref)
            if not path.is_absolute():
                path = root.parent / path
            try:
                resolved = path.resolve()
                if root in resolved.parents and resolved.is_file():
                    resolved.unlink()
                    deleted_files += 1
            except OSError:
                logger.warning("purge_face_sample_file_failed path=%s", ref)

        deleted_samples = 0
        try:
            with self.connect() as conn:
                cur = conn.execute("DELETE FROM muestras")
                deleted_samples = int(cur.rowcount if cur.rowcount is not None else 0)
                conn.execute("DELETE FROM model_meta WHERE id=1")
        except Exception:
            logger.exception("db_purge_face_samples_failed")
            raise

        model_removed = False
        try:
            path = Path(model_path)
            if path.exists() and path.is_file():
                path.unlink()
                model_removed = True
        except OSError:
            logger.warning("purge_model_file_failed path=%s", model_path)

        return {
            "ok": True,
            "deleted_files": deleted_files,
            "deleted_samples": deleted_samples,
            "model_removed": model_removed,
        }

    def insert_access(
        self,
        user_id: Optional[int],
        confianza: Optional[float],
        resultado: str,
        motivo: Optional[str] = None,
    ) -> int:
        resultado_norm = (resultado or "").strip().upper()
        if resultado_norm not in ACCESS_RESULTS_ALLOWED:
            raise ValueError("resultado inválido")

        conf = None if confianza is None else float(confianza)
        if conf is not None and not (0.0 <= conf <= 100.0):
            raise ValueError("confianza fuera de rango 0..100")

        uid = None if user_id is None else int(user_id)
        if uid is not None and uid <= 0:
            raise ValueError("user_id inválido")

        motivo_norm = None
        if motivo is not None:
            motivo_norm = motivo.strip()
            if motivo_norm == "":
                motivo_norm = None
            if motivo_norm is not None and len(motivo_norm) > 300:
                motivo_norm = motivo_norm[:300]

        return self.execute(
            "INSERT INTO accesos (usuario_id, confianza, resultado, motivo) VALUES (?, ?, ?, ?)",
            (uid, conf, resultado_norm, motivo_norm),
        )

    def list_user_access_logs(self, user_id: int, limit: int = 50) -> list[dict[str, Any]]:
        if int(user_id) <= 0:
            raise ValueError("user_id inválido")
        lim = max(1, min(500, int(limit)))
        rows = self.fetch_all(
            """
            SELECT a.id, a.fecha, a.confianza, a.resultado, a.motivo
            FROM accesos a
            WHERE a.usuario_id = ?
            ORDER BY a.id DESC
            LIMIT ?
            """,
            (int(user_id), lim),
        )
        return [dict(row) for row in rows]

    def count_user_samples(self, user_id: int) -> int:
        if int(user_id) <= 0:
            raise ValueError("user_id inválido")
        row = self.fetch_one(
            "SELECT COUNT(*) AS total FROM muestras WHERE usuario_id=? AND preprocess_mode=?",
            (int(user_id), config.sface_preprocess_mode),
        )
        return row["total"] if row else 0

    def list_access_logs(self, limit: int = 100, offset: int = 0) -> list[dict[str, Any]]:
        lim = int(limit)
        if lim <= 0:
            lim = 1
        if lim > 1000:
            lim = 1000
        off = max(0, int(offset))

        rows = self.fetch_all(
            """
            SELECT a.id, a.usuario_id, a.fecha, a.confianza, a.resultado, a.motivo, u.nombre
            FROM accesos a
            LEFT JOIN usuarios u ON a.usuario_id = u.id
            ORDER BY a.id DESC
            LIMIT ? OFFSET ?
            """,
            (lim, off),
        )
        return [dict(row) for row in rows]

    # ── model_meta helpers ──────────────────────────────────────────

    def get_model_meta(self) -> Optional[dict[str, Any]]:
        row = self.fetch_one("SELECT trained_at, samples, unique_users FROM model_meta WHERE id=1")
        return dict(row) if row else None

    def save_model_meta(self, samples: int, unique_users: int) -> None:
        self.execute(
            """
            INSERT INTO model_meta (id, trained_at, samples, unique_users)
            VALUES (1, CURRENT_TIMESTAMP, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                trained_at = CURRENT_TIMESTAMP,
                samples = excluded.samples,
                unique_users = excluded.unique_users
            """,
            (int(samples), int(unique_users)),
        )

    # ── administradores helpers ─────────────────────────────────────

    def get_admin_by_username(self, username: str) -> Optional[dict[str, Any]]:
        row = self.fetch_one(
            "SELECT id, username, password_hash, rol, activo FROM administradores WHERE username=? AND activo=1",
            (username,),
        )
        return dict(row) if row else None

    def upsert_admin_password(self, username: str, password_hash: str) -> None:
        self.execute(
            """
            INSERT INTO administradores (username, password_hash, rol, activo)
            VALUES (?, ?, 'CEO', 1)
            ON CONFLICT(username) DO UPDATE SET
                password_hash = excluded.password_hash,
                activo = 1
            """,
            (username, password_hash),
        )


db = Database()
