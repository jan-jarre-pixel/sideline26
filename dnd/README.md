# D&D Charakterbögen – kostenlose Online-Web-App

**Live:** https://jan-jarre-pixel.github.io/sideline26/dnd/

Die Web-App übernimmt die vier Charaktere aus `charakterboegen_offline_7.html` (Lennox, Grandia Rythna, Sashee und Peisinoe), inklusive Würfel, Kampfmodus, Zauber, Trefferpunkte, Ressourcen, Notizen, Rast und manueller Sicherung.

## Zugang – keine E-Mail erforderlich

1. Link öffnen.
2. Den eigenen Charakter auswählen; der Spielleiter wählt „Spielleiter“.
3. Den **privaten Zugangscode** eingeben, den der Spielleiter separat übermittelt hat.
4. Bei erfolgreicher Anmeldung werden die Daten geladen und Änderungen automatisch in der Supabase-Datenbank gespeichert.

Der Code wird auf diesem Gerät in `localStorage` gespeichert, bis „Abmelden“ betätigt wird. **Jeder, der einen Code kennt, hat die entsprechende Berechtigung**: Spieler dürfen ihren Bogen lesen und bearbeiten, der Spielleiter darf alle Bögen ausschließlich lesen. Codes daher nicht mit Fremden teilen und auf gemeinsam genutzten Geräten abmelden.

Die fünf privaten Zugangscodes befinden sich **nicht im GitHub-Repository**, sondern nur in der separat bereitgestellten Datei `DnD_private_Einladungscodes.txt`.

## Technik

- **GitHub Pages:** veröffentlicht die statischen Dateien in diesem Unterordner.
- **Supabase Postgres:** speichert einen JSON-Bogen pro Charakter.
- **Supabase Data API:** ausschließlich die drei passwortgeschützten RPC-Funktionen `read_character`, `write_character`, `read_party` sind für anonyme Besucher aufrufbar. Jede Funktion prüft den SHA-256-Digest des zugehörigen, zufälligen privaten Codes **bevor** sie Daten liest oder schreibt.
- **RLS:** alle Tabellen sind für anonyme direkte Abfragen und Änderungen gesperrt. Die Funktionen sind `SECURITY DEFINER` mit leerem `search_path` und haben bewusst nur die für ihren Zweck nötigen Operationen. Die sicherheitsbezogenen Supabase-Hinweise zu anonym ausführbaren Funktionen sind deshalb erwartbar. **Keine geheimen Supabase-API-Keys** befinden sich im Browser.
- **Synchronisierung:** Änderungen werden nach einer kurzen Verzögerung gespeichert. Die Spielleiterübersicht wird ca. alle vier Sekunden aktualisiert (Polling) und ist schreibgeschützt. Bei einem Verbindungsfehler gibt die App eine Warnung aus und wiederholt fehlgeschlagene Speichervorgänge.

Die Standard-Mailanmeldung wurde bewusst entfernt, weil der integrierte Supabase-Maildienst auf dem kostenlosen Hosting nur Supabase-Organisationsteilnehmer anschreibt und für die Spielergruppe daher nicht ausreicht. Es wird kein E-Mail-Versand und kein Auth-Redirect benötigt.

## Datenbank-Setup (nur für neue Kopien)

Für diese öffentliche App wurde das separate Supabase-Projekt `D&D Charakterboegen Online` unter der bestehenden Organisation bereits eingerichtet. Die SQL-Dateien hier sind für Audits/Recovery und zukünftige Neuinstallationen gedacht.

- Zuerst `supabase/schema.sql` einmal in einem **separaten Projekt** ausführen (Tabellen und private Code-Hashes).
- Danach `supabase/code_access.sql` einmal ausführen (drei abgesicherte RPC-Funktionen).
- Den Publishable Key und die Projekt-URL in `config.js` setzen. **Niemals** `service_role` oder Secret Keys in GitHub schreiben.
- In einer privaten Umgebung mit mehreren Rollen sowohl falsche Codes als auch direkte Tabellenrechte und erlaubte Spielerzugriffe testen.

**Achtung:** Ein neues Projekt benötigt neue Zufallscodes und ihre zugehörigen Digests; die Digests aus der bestehenden Installation ohne die privaten Originalcodes reichen für einen neuen, unabhängigen Satz von Spielern nicht aus.

## Sicherheit, Datenschutz, Grenzen

- Dies ist **Code-basierte Anmeldung**, keine persönliche Identifizierung. Wird ein Spielercode weitergegeben, darf jeder mit diesem Code den entsprechenden Charakter ändern; Code bei Verlust in der Datenbank erneuern.
- Supabase-Free-Projekte können bei längerer Inaktivität pausiert werden. GitHub Pages bleibt dann erreichbar, die Cloud-Speicherung erst nach dem Aufwecken wieder verfügbar.
- Bei gleichzeitigem Bearbeiten desselben Charakters auf mehreren Geräten gewinnt der letzte vollständige Speichervorgang. Spieler sollten ihren eigenen Code nur selbst verwenden.
- GitHub-Repositories und statische Vorlagen sind öffentlich; **private Codes, E-Mail-Adressen und die persönlichen Spielstände** gehören nicht dorthin.
- Der Code kann in `localStorage` auf gemeinsam genutzten Geräten ausgelesen werden. Auf solchen Geräten abmelden und ggf. Browserdaten löschen.

## Verifikation

- `node tests/smoke.cjs`: Code-Anmeldung, Ablehnung falscher Codes, Spieler-Speicherung, Abmeldung und schreibgeschützte Spielleiteransicht.
- Die reale Datenbank wurde mit einer vollständig zurückgerollten, temporären Testkonfiguration als `anon` geprüft: korrekter Testcode liest/speichert, falscher Code verweigert, Spielleiter-Code kann nicht schreiben, direkter Tabellenzugriff verweigert. Die Originalcodes und Spielstände wurden unverändert erhalten.
- Öffentliche Seite wurde nach Veröffentlichung im Browser geprüft: Login-Formular, vier Charakteroptionen und Spielleiteroption werden angezeigt, kein sichtbarer JS-Fehler.

## Versionierung

Die Web-App ist derzeit im Unterordner `dnd/` von `jan-jarre-pixel/sideline26` veröffentlicht. Das bestehende Fußballmanager-Projekt im Wurzelverzeichnis bleibt unberührt.