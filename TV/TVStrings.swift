import Foundation

// Textes propres à l'app Apple TV ; les autres viennent des traductions de
// l'app iPhone (translate). German only, like the iPhone app.
private let tvStrings: [String: String] = [
    "tv_following": "Du folgst",
    "tv_top": "Top",
    "tv_categories": "Kategorien",
    "tv_search": "Suche",
    "tv_account": "Konto",
    "tv_live": "LIVE",
    "tv_world": "Weltweit",
    "tv_need_login": "Melde dich im Tab „Konto“ an, um deine gefolgten Kanäle zu sehen, die live sind.",
    "tv_no_live": "Gerade keine Livestreams.",
    "tv_error": "Laden fehlgeschlagen. Versuch es gleich noch mal.",
    "tv_search_prompt": "Kanalname",
    "tv_watch_live": "Live ansehen",
    "tv_videos": "Videos",
    "tv_no_videos": "Keine Videos.",
    "tv_login": "Mit Twitch anmelden",
    "tv_login_intro": "Melde dich mit Twitch an, um deine gefolgten Kanäle zu sehen. Alles andere funktioniert ohne Konto.",
    "tv_login_steps": "Scanne den QR-Code mit deinem Handy oder öffne",
    "tv_login_code": "und gib diesen Code ein:",
    "tv_login_waiting": "Warte auf Bestätigung …",
    "tv_login_expired": "Der Code ist abgelaufen oder die Anmeldung ist fehlgeschlagen. Versuch es noch mal.",
    "tv_logged_in": "Bei Twitch angemeldet",
    "tv_logout": "Abmelden",
    "tv_settings": "Einstellungen",
    "tv_back": "Zurück",
    "tv_offline": "Dieser Kanal ist nicht live.",
    "tv_error_live": "Dieser Livestream ließ sich nicht starten.",
    "tv_error_vod": "Dieses VOD wurde nicht gefunden.",
    "tv_audio": "Nur Audio",
    "tv_chat": "Chat",
    "tv_chat_waiting": "Verbinde mit dem Chat …",
    "tv_chat_loading": "Chat wird geladen …",
    "tv_hidden_hint": "Halte auf einer Top- oder Kategorie-Karte die mittlere Taste gedrückt und wähle „Ausblenden“.",
    "tv_chat_show": "Chat anzeigen",
    "tv_chat_side": "Chat-Seite",
    "tv_chat_left": "Links",
    "tv_chat_right": "Rechts",
    "tv_chat_height": "Chat-Höhe",
    "tv_chat_full": "Volle Höhe",
    "tv_chat_top": "Obere Hälfte",
    "tv_chat_bottom": "Untere Hälfte",
    "tv_chat_all": "Für alle Kanäle verwenden",
    "tv_chat_reset": "Zurück zur Standardposition",
    "tv_chat_layout_hint": "Standardposition. Im Player verschiebt das Chat-Menü den Chat für den aktuellen Kanal, und die App merkt sich das für diesen Kanal.",
    "tv_chat_forget": "Positionen pro Kanal vergessen",
]

func tvTranslate(_ key: String, _ lang: Lang) -> String {
    tvStrings[key] ?? translate(key, lang)
}
