# D&D Charakterbögen – Online-Spielgruppe

Online-Web-App im Unterordner `dnd/` von `jan-jarre-pixel/sideline26`.
Der ursprüngliche Fußballmanager im Repository bleibt unberührt.

- **Website:** https://jan-jarre-pixel.github.io/sideline26/dnd/
- **Datenbank:** eigenes Supabase-Projekt „D&D Charakterboegen Online“ (Projekt-ID `tczmeehxpurokbmkynpd`, kostenlose Stufe, Frankfurt).
- **Frontend:** `index.html` und `online.js` (HTML/JS, iPhone/iPad/Desktop).
- **Zugriff:** Supabase E-Mail-Login, pro Charakter ein geheimer Einladungscode, ein Spielleiter-Code; keine Klartext-Codes in diesem Repository.
- **Backend:** Vier Charakterplätze; Row Level Security (RLS), nur Spieler dürfen eigene Daten ändern; Spielleiter liest alle.

## EINMALIG vor dem ersten Login

**Supabase Dashboard**: https://supabase.com/dashboard/project/tczmeehxpurokbmkynpd/auth/url-configuration

Unter **Authentication → URL Configuration**:

1. **Site URL** auf `https://jan-jarre-pixel.github.io/sideline26/dnd/` setzen.
2. Unter **Redirect URLs** exakt `https://jan-jarre-pixel.github.io/sideline26/dnd/` hinzufügen.
3. Änderungen speichern.

Ohne diese Auth-Konfiguration können Anmeldelinks falsch weiterleiten. Die GitHub-Dateien und Datenbank sind bereits bereitgestellt; für einen vollständigen Mehrnutzer-Livetest ist die URL-Konfiguration nötig.

## Testablauf

1. Spielleiter mit eigener E-Mail anmelden und den **privaten Spielleiter-Code** eingeben.
2. Vier Spieler melden sich mit jeweils eigener E-Mail an und übernehmen einen Charakter mit ihrem **privaten Charakter-Code**.
3. Einen Trefferpunkt ändern, auf `Online gespeichert ✓` achten, auf einem zweiten Gerät neu laden und beim Spielleiter Live-Änderung prüfen.
4. Anmeldung/Schreibzugriff auf fremde Charaktere (RLS) und falsche Codes negativ testen.

**Kosten:** Supabase-Projekt wurde ausdrücklich mit 0 USD/Monat bestätigt. GitHub Pages hostet diese Dateien aus einem öffentlichen Repository.

**Sicherheit:** Niemals Dateien mit Klartext-Einladungscodes oder `service_role`-/Secret-Keys in `dnd/` committen. Der öffentliche `sb_publishable_`-Schlüssel ist bewusst für die Browser-App gedacht.

**Hinweise:** GitHub Pages ist öffentlich sichtbar. Die kostenlose Supabase-E-Mail-Funktion hat Versandlimits; kostenlose Datenbankprojekte können bei Inaktivität pausieren. Cloud-Charakterbögen werden nicht automatisch aus alten Offline-Browsern übernommen, können jedoch nach dem Login per Sicherungscode importiert werden.
