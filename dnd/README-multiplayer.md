# D&D Multiplayer (Version 2.0 – Free Tier)

## Links

- Charakterbögen: `/dnd/`
- Gemeinsamer Spieltisch: `/dnd/spieltisch.html`
- Bestehende Zugangscodes werden weiterhin verwendet; **keine Codes in Git einchecken**.

## Funktionen

- Gemeinsame Spielrunde: Neue Sitzung, Pause, Fortsetzen und Beenden (nur Spielleiter)
- Servergenerierte Würfelproben mit W4/W6/W8/W10/W12/W20/W100, Vorteilen, Nachteilen und Modifikatoren
- Öffentliches Würfelprotokoll; geheime Spielleiterwürfe nur für den Spielleiter
- Gruppenübersicht (nur ausdrücklich freigegebene HP/RK/Klasse/Stufe)
- Online-Anwesenheit via Heartbeat, automatische Wiederverbindung
- Private Spielleiter-Notizen
- Bereits bestehende Würfelbuttons in den Charakterbögen verwenden den neuen Serverwürfel
- Nutzbar ohne E-Mail, neue Konten oder zusätzliche bezahlte Dienste

## Architektur

Die Anwendung nutzt bestehende 40-Zeichen-Zugangscodes. Ihre SHA-256-Prüfwerte liegen im nicht öffentlich exponierten Schema `game_private`. Die neuen Tabellen (`dnd_room`, `dnd_rolls`, `dnd_presence`) sind mit RLS geschützt und haben **keine** direkten `anon`-Tabellenberechtigungen. Die ausdrücklich freigegebenen `SECURITY DEFINER`-Funktionen prüfen den Code bei **jedem** Aufruf.

Beim Würfeln generiert `pgcrypto.gen_random_bytes` den Zufallswert auf dem Server. Ergebnisse werden persistent gespeichert. Client-Anfragen enthalten eine UUID als Idempotenzschlüssel. Geheime Würfe werden serverseitig aus Spielerantworten herausgefiltert.

Die Oberfläche bezieht den aktuellen Gruppen-/Würfelstand per codegeschützter RPC im Intervall von ungefähr **3,2 Sekunden**. Das ist **Near-Live-Polling**, kein privater Supabase-Realtime-WebSocket: Die bestehenden codebasierten Zugänge besitzen noch keinen benutzerspezifischen JWT zur sicheren Realtime-Channel-Autorisierung. Unautorisierte öffentliche Broadcast-Channels werden bewusst vermieden. Bei Bedarf kann später eine sauber gesicherte anonyme Supabase-Auth-Migration erfolgen.

## Verwendung

1. Spielleiter meldet sich über `spieltisch.html` mit dem bisherigen privaten Spielleitercode an.
2. Spielleiter startet eine neue Runde.
3. Spieler öffnen `spieltisch.html`, wählen ihren Charakter und geben ihren bisherigen Zugangscode ein. Nach vorheriger Anmeldung am Charakterbogen wird der Code im selben Browser wiederverwendet.
4. Würfelproben über den Spieltisch oder den Charakterbogen werden in der aktiven Sitzung gespeichert. Öffentliche Ereignisse sind bei den anderen nach dem nächsten Poll sichtbar.
5. Spielleiter kann geheime Würfe und private Notizen nutzen sowie die Sitzung pausieren und beenden.

## Bekannte Grenzen und nächste Schritte

- Gleichzeitige Änderungen **an demselben Charakterbogen** sind weiterhin anfällig für Überschreiben, weil die Bestands-App das gesamte JSONB-Dokument speichert. Die Zugangscodes sollen deshalb nicht geteilt werden. Als späteren Schritt atomare Feld-Updates mit Version/ETag ergänzen.
- Die Anwesenheit ist eine Annäherung anhand des letzten Heartbeats; Hintergrundtabs gelten nach etwa 50 Sekunden als offline.
- Für Spielleiter-Notizen gibt es vorerst nur einen gemeinsamen privaten Textbereich; keine Versionshistorie.
- Würfelhistorie im UI zeigt die letzten 70 Ereignisse einer Sitzung; vollständige ältere Ereignisse verbleiben in Supabase.
- Geheime Würfe sind inhaltlich geheim, allerdings können Lücken in fortlaufenden Datenbank-Ereignis-IDs theoretisch auf nicht sichtbare Ereignisse hinweisen.
- Es gibt noch keinen Gegner- oder Initiative-Tracker, keine Battle Map, keinen Chat.
- Das Frontend erhält ausschließlich einen öffentlichen Supabase-Publishable-Key, niemals einen Secret- oder Service-Role-Key.

## Sicherheitsprüfung

- Ungültige oder leere Zugangscodes abgewiesen
- Direkte Tabellenselektion als `anon` gesperrt
- Nur der Spielleiter kann Sitzung verwalten und geheime Ereignisse senden/sehen
- Gleiche Würfel-Request-ID erzeugt keinen zweiten Eintrag
- Pausierte Sitzungen akzeptieren keine neuen Würfe
- Prüfung durch rollbackfähige SQL-Integrationstests, ohne echte Charakterstände zu verändern

**Hinweis zum Supabase Security Advisor:** Die angezeigten Warnungen für `anon`-ausführbare `SECURITY DEFINER`-RPCs sind bei dieser Codezugangsarchitektur bewusst erforderlich. Ihre Zugriffe sind auf spezifische geprüfte Codefunktionen begrenzt. Neue Endpunkte müssen vor Freigabe analog getestet werden.

## Betrieb

- Die Seite wird über GitHub Pages bereitgestellt.
- Das Projekt verwendet die bestehenden kostenlosen GitHub- und Supabase-Dienste.
- Wenn das Supabase-Projekt im Free-Tier wegen Inaktivität pausiert, kann es im Supabase-Dashboard wieder aktiviert werden.
- Kein kostenpflichtiger CI-Dienst notwendig. Für lokale Tests: `node --check` und Playwright (mit installierten Browserbinaries).
