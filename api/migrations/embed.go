// Package migrations embeds the SQL schema migrations that the API applies at
// startup, in lexical filename order. Add a new NNN_name.sql file to change the
// schema; never edit one that has already shipped.
package migrations

import "embed"

//go:embed *.sql
var FS embed.FS
