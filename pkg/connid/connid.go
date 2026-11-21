// Package connid names the connections of this plugin.
//
// A connection is one context of one kubeconfig source. Two sources can define
// a context with the same name, so the context name cannot be the ID. The ID is
//
//	<slug>-<hash>
//
// The slug is the context name made readable. ASCII letters are lower-cased,
// every character outside [a-z0-9._-] becomes '-', runs of '-' collapse into
// one, leading and trailing '-' are trimmed, and what is left is cut to 48
// characters (trailing '-' trimmed again). If nothing is left, the slug is
// "context". Only ASCII letters are folded, so the slug depends neither on a
// Unicode table nor on the language that computes it. The slug is for reading:
// uniqueness never depends on it.
//
// The hash is the first 10 lower-case hex digits of the SHA-256 of the source
// key, SourceKey: the kind of source, the locator of the source and the exact
// context name, separated by NUL. The hash is always present, even when a name
// is unique, so that adding a second source later never changes an ID that
// exists.
//
// An ID has only [a-z0-9._-] characters, never starts with '-' and has at most
// 59 characters. The path of a kubeconfig, the home directory and the user name
// are hashed and never appear in it.
//
// The ID is not the kube context. The Name of a connection is the exact context
// name, and its public data carries it under DataKeyContext, which is what any
// code that selects a context (client-go, kubectl) must read. Nothing may pass
// an ID where a kubeconfig context name is expected.
//
// Every function here is a pure function of its arguments: no file system, no
// environment, no clock.
package connid

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
)

const (
	// DataKeyContext is the key, in the public data of a connection, of the exact
	// name of the kubeconfig context the connection stands for. Name carries the
	// same text for display, and the user may edit it, so code that selects a
	// context reads this key instead.
	DataKeyContext = "context"

	maxSlug   = 48
	emptySlug = "context"
	hashBytes = 5 // hex-encoded: 10 digits
)

// ErrNoContext is returned for connection data that does not carry a usable
// kubeconfig context name.
var ErrNoContext = errors.New("kubeconfig context is required")

// Kind says what sort of source a connection was found in. It is part of the
// source key, so a later kind of source gets IDs of its own without any ID that
// exists today changing. Only the kinds defined here exist.
type Kind string

// KindFile is a kubeconfig file on the local file system. Its locator is the
// path returned by FileLocator.
const KindFile Kind = "file"

// FileLocator returns the locator of a kubeconfig file: its cleaned absolute
// path, which is filepath.Abs followed by filepath.Clean. Symlinks are not
// resolved, so a file reached through a link has the locator of the link.
//
// Windows file systems ignore case, so on Windows the whole path is lower-cased,
// drive letter included, and one file spelled two ways is one source. On every
// other system the case is kept. goos is the runtime.GOOS of the machine that
// reads the file; it is a parameter so that the rule can be checked on any
// machine.
//
// cleanAbsPath must already be cleaned and absolute: making it so reads the
// working directory, and FileLocator does no I/O.
func FileLocator(cleanAbsPath, goos string) string {
	if goos == "windows" {
		return strings.ToLower(cleanAbsPath)
	}
	return cleanAbsPath
}

// SourceKey is the text the hash of an ID is taken over: kind, locator and the
// exact context name, separated by NUL. A locator must not contain NUL, which
// no file path does, so a key has one reading.
func SourceKey(kind Kind, locator, contextName string) string {
	return string(kind) + "\x00" + locator + "\x00" + contextName
}

// ID returns the ID of the connection for the context contextName, exactly as
// the kubeconfig names it, in the source (kind, locator).
func ID(kind Kind, locator, contextName string) string {
	sum := sha256.Sum256([]byte(SourceKey(kind, locator, contextName)))
	return slug(contextName) + "-" + hex.EncodeToString(sum[:hashBytes])
}

// FromLegacyID returns the ID that a connection has today, given the ID it had
// before IDs were derived and the source it was found in. Before, the ID of a
// connection was its context name, so this is ID(kind, locator, legacyID).
//
// State that was stored under a legacy ID (saved routes, per-connection
// settings) is moved to the new one by calling this, so that a migration has one
// documented entry point and never re-derives the format.
func FromLegacyID(legacyID string, kind Kind, locator string) string {
	return ID(kind, locator, legacyID)
}

// ContextFromData returns the exact kubeconfig context name that the public data
// of a connection carries under DataKeyContext. A name that is missing, not a
// string or empty is ErrNoContext: an empty name would make client-go use the
// current context of the file instead.
func ContextFromData(data map[string]any) (string, error) {
	name, ok := data[DataKeyContext].(string)
	if !ok || name == "" {
		return "", ErrNoContext
	}
	return name, nil
}

// slug is the readable part of an ID; see the package documentation.
func slug(contextName string) string {
	var b strings.Builder
	dash := true // so that a leading separator is dropped
	for _, r := range contextName {
		if 'A' <= r && r <= 'Z' {
			r += 'a' - 'A'
		}
		if 'a' <= r && r <= 'z' || '0' <= r && r <= '9' || r == '.' || r == '_' {
			b.WriteByte(byte(r))
			dash = false
		} else if !dash {
			b.WriteByte('-')
			dash = true
		}
		if b.Len() > maxSlug {
			break // the rest is cut off anyway
		}
	}
	s := strings.TrimRight(b.String(), "-")
	if len(s) > maxSlug {
		s = strings.TrimRight(s[:maxSlug], "-")
	}
	if s == "" {
		return emptySlug
	}
	return s
}
