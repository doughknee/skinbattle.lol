// Package migrations embeds the SQL migration files so they can be used
// at runtime without requiring them to be present on the filesystem.
package migrations

import "embed"

// FS contains all *.sql migration files.
//
//go:embed *.sql
var FS embed.FS
