# Security

## Safe use

Keep gateway and probe keys in files that are readable only by the service. Never commit secret files or place credentials in Compose YAML, issue reports, logs, metrics, or screenshots. Keep the local listener bound to loopback and use HTTPS for hosted upstream connections.

Do not submit private keys, seed phrases, bearer credentials, cookies, passwords, signatures, signed transactions, or database credentials. Snap rejects common sensitive field names and value shapes, but callers remain responsible for reviewing context before sending it.

## Reporting

Please report suspected vulnerabilities privately to the FrelyHQ maintainers before opening a public issue. Include a concise description, affected version, reproduction steps that contain no credentials, and the impact. Allow time for triage and a fix before public disclosure.

Do not include live keys, personal data, or unredacted request and response bodies in a report.
