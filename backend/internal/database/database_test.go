package database

import (
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun/dialect"
)

func TestInitDBPreservesSQLiteDefault(t *testing.T) {
	db, err := InitDB("file::memory:?cache=shared")
	require.NoError(t, err)
	defer db.Close()

	var one int
	require.NoError(t, db.QueryRow("SELECT 1").Scan(&one))
	require.Equal(t, 1, one)
}

func TestInitDBWithDriverInitializesSQLite(t *testing.T) {
	db, err := InitDBWithDriver("sqlite", "file::memory:?cache=shared")
	require.NoError(t, err)
	defer db.Close()

	var one int
	require.NoError(t, db.QueryRow("SELECT 1").Scan(&one))
	require.Equal(t, 1, one)
}

func TestInitDBWithDriverRejectsUnsupportedDriver(t *testing.T) {
	db, err := InitDBWithDriver("mysql", "mysql://example")
	require.Nil(t, db)
	require.ErrorContains(t, err, "unsupported database driver")
}

func TestJSONTextExprForDialect(t *testing.T) {
	require.Equal(t, "json_extract(job.payload, '$.post_id')", JSONTextExprForDialect(dialect.SQLite, "job.payload", "post_id"))
	require.Equal(t, "(job.payload::jsonb ->> 'post_id')", JSONTextExprForDialect(dialect.PG, "job.payload", "post_id"))
}

func TestDateExprForDialect(t *testing.T) {
	require.Equal(t, "DATE(p.scheduled_at)", DateExprForDialect(dialect.SQLite, "p.scheduled_at", ""))
	require.Equal(t, "DATE(datetime(p.scheduled_at, '+01:30'))", DateExprForDialect(dialect.SQLite, "p.scheduled_at", "+01:30"))
	require.Equal(t, "DATE(p.scheduled_at + (-300 * INTERVAL '1 minute'))", DateExprForDialect(dialect.PG, "p.scheduled_at", "-05:00"))
}

func TestInitDBWithDriverBuildsPostgresHandle(t *testing.T) {
	db, err := InitDBWithDriver("postgres", "postgres://openpost:secret@localhost:5432/openpost?sslmode=disable")
	require.NoError(t, err)
	defer db.Close()

	require.NotNil(t, db)
}
