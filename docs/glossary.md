# Glossary

Email has a lot of old, short names. These are the ones that come up in the Nexus code.

**IMAP** (Internet Message Access Protocol): how a mail app reads mail that stays on the server.
Folders, read and starred state live on the server, so every app sees the same thing.

**POP3** (Post Office Protocol): an older way to read mail: the app downloads messages, and
everything else (folders, read state) exists only in that app.

**SMTP** (Simple Mail Transfer Protocol): how mail is sent. Nexus hands a finished message to the
account's SMTP server, which delivers it.

**UID**: the number IMAP gives each message in a folder. **UIDVALIDITY** changes when the server
renumbers a folder; Nexus then downloads that folder again. **UIDL** is POP3's unique id per message.

**CONDSTORE / modseq**: an IMAP extension where each folder has a change counter, so Nexus can
skip re-checking flags when nothing changed.

**Special-use folders**: flags such as `\Sent` or `\Junk` that tell a mail app which folder is
which, whatever its name or language.

**MIME**: the format of an email: headers, then one or more parts (text, HTML, attachments),
nested in `multipart/...` containers. A raw email as stored is called an **.eml** file.

**Message-ID / In-Reply-To / References**: headers that link a reply to the message it answers,
so mail apps can show conversations.

**Bcc**: blind copy. Bcc addresses are given to the SMTP server but never written into the message.

**mbox**: many emails in one file, each starting with a `From ` line. Used for import and export.

**vCard (.vcf)**: the standard file format for contacts.

**iCalendar (.ics)**: the standard format for calendar events. **JSON-LD** (schema.org) is the
data airlines and booking sites hide inside emails; Nexus reads both to find events.

**S/MIME**: signing and encrypting email with certificates (like the ones websites use).
Done on the server with the `openssl` tool. A **.p12** file holds a certificate and its private key.

**PGP / OpenPGP**: signing and encrypting email with keys you make yourself. In Nexus it runs only
in the browser.

**OAuth2**: "Sign in with Google/Microsoft". Nexus gets a **refresh token** (kept encrypted) and
trades it for short-lived **access tokens** when it connects to the mail server (XOAUTH2).

**TOTP / 2FA**: the 6-digit codes from an authenticator app (two-factor authentication).

**ACL** (access control list): who may do what with a shared mail account: owner, editor, viewer.

**CSP** (Content-Security-Policy): a header telling the browser which scripts and resources a page
may load. Nexus's forbids scripts from anywhere but itself.

**XSS** (cross-site scripting): getting a script to run inside someone else's page, for example
through an email's HTML. Sanitizing plus a sandboxed frame is how Nexus prevents it.

**BullMQ**: the job queue library (on Redis) behind syncs and scheduled sends.
