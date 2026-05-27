from database.db import Database


def test_config_persists_support_phone(tmp_path):
    db_path = tmp_path / "camerapi.sqlite"
    database = Database(str(db_path), schema_path="database/schema.sql")
    database.init_db()

    initial = database.get_config()
    assert initial["support_phone"] == ""

    database.update_config(72.5, 6, 4, "+52 55 1234 5678")

    updated = database.get_config()
    assert updated["umbral_confianza"] == 72.5
    assert updated["tiempo_apertura_seg"] == 6
    assert updated["max_intentos"] == 4
    assert updated["support_phone"] == "+52 55 1234 5678"
