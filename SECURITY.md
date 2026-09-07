# Security

## Safe use

Keep service and Frely model-access keys in files that are readable only by the service. Never commit secret files or place credentials in Compose YAML, issue reports, logs, metrics, or screenshots. Keep the host listener bound to loopback. The container attaches only to the explicit local-development network, and the model client accepts only supported local host forms with an exact `/v1` path. Operators remain responsible for ensuring that local endpoint is Frely.

Do not restore generic `MODEL_*` configuration or configure Swarm with a final Provider URL or credential. A Provider credential belongs only to Frely.

Do not submit private keys, seed phrases, bearer credentials, cookies, passwords, signatures, signed transactions, or database credentials. Snap rejects common sensitive field names and value shapes, but callers remain responsible for reviewing context before sending it.

## Reporting

Please report suspected vulnerabilities privately to the FrelyHQ maintainers before opening a public issue. Include a concise description, affected version, reproduction steps that contain no credentials, and the impact. Allow time for triage and a fix before public disclosure.

Do not include live keys, personal data, or unredacted request and response bodies in a report.
