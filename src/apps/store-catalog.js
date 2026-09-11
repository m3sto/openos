/* ==========================================================================
   OpenOS · apps/store-catalog.js — the catalogue that ships with the system
   These entries are always available, even with no network and no account.
   ========================================================================== */

import { EXAMPLES } from '../core/seed.js';

const UNIT = `app {
  name: "Birim Çevirici"
  icon: "calc"
  tint: ["#40c8e0", "#0a7b96"]
  width: 400
  height: 400
}

state value = 1
state from = "m"
state to = "ft"

let units = { m: 1, km: 1000, cm: 0.01, ft: 0.3048, in: 0.0254, mi: 1609.34 }

fn convert() {
  return value * units[from] / units[to]
}

view {
  VStack(spacing: 16, padding: 22, grow: true) {
    Label("Birim Çevirici", style: "title")
    TextField(str(value), placeholder: "değer", onChange: fn(v) { value = num(v) })
    HStack(spacing: 10) {
      Select(options: keys(units), value: from, bind: "from", grow: true)
      Icon("arrowR", size: 16)
      Select(options: keys(units), value: to, bind: "to", grow: true)
    }
    Card("Sonuç") {
      Label(format(convert(), 4) + " " + to, style: "title2", tint: "var(--accent)")
    }
    Label("Tüm dönüşümler metre üzerinden yapılır.", style: "caption")
  }
}
`;

const PASSWORD = `app {
  name: "Şifre Üretici"
  icon: "lock"
  tint: ["#30d158", "#0c7a34"]
  width: 420
  height: 400
}

state length = 16
state symbols = true
state out = ""

fn generate() {
  let base = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  if symbols { base = base + "!@#%^&*-_=+?" }
  let s = ""
  for i in int(length) {
    s = s + char_at(base, random(len(base)))
  }
  out = s
}

view {
  VStack(spacing: 16, padding: 22, grow: true) {
    Label("Şifre Üretici", style: "title")
    Card() {
      Label(out == "" ? "— üretmek için düğmeye basın —" : out, style: "mono", align: "center")
    }
    Label("Uzunluk: " + int(length), style: "callout")
    Slider(value: length, min: 6, max: 48, step: 1, bind: "length")
    Toggle("Sembolleri dahil et", value: symbols, bind: "symbols")
    Button("Üret", variant: "primary", full: true, size: "lg", onClick: generate)
  }
}
`;

const DICE = `app {
  name: "Zar"
  icon: "grid"
  tint: ["#ff9f0a", "#c05a00"]
  width: 340
  height: 380
}

state dice = [1, 1]
state rolls = 0

fn roll() {
  dice = map(dice, fn(d) { return random(1, 6) })
  rolls = rolls + 1
}

fn face(n) {
  let faces = ["⚀", "⚁", "⚂", "⚃", "⚄", "⚅"]
  return faces[n - 1]
}

view {
  VStack(spacing: 18, padding: 24, align: "center", justify: "center", grow: true) {
    HStack(spacing: 14) {
      for d in dice {
        Label(face(d), font: 62)
      }
    }
    Label("Toplam: " + sum(dice), style: "title2")
    Button("At", variant: "primary", size: "xl", onClick: roll)
    HStack(spacing: 8) {
      Button("Zar ekle", size: "sm", onClick: fn() { push(dice, 1); refresh() })
      Button("Çıkar", size: "sm", onClick: fn() { if len(dice) > 1 { pop(dice) } refresh() })
    }
    Label(rolls + " atış", style: "caption")
  }
}
`;

const KANBAN = `app {
  name: "Kanban"
  icon: "layers"
  tint: ["#bf5af2", "#6b2494"]
  width: 760
  height: 500
}

state board = store_get("board", {
  "Yapılacak": ["OpenSharp öğren", "Duvar kâğıdı seç"],
  "Yapılıyor": ["OpenOS'u keşfet"],
  "Bitti": ["Kurulumu tamamla"]
})

fn save() { store_set("board", board) }

fn move(col, i, dir) {
  let cols = keys(board)
  let idx = index_of(cols, col) + dir
  if idx < 0 or idx >= len(cols) { return }
  let item = board[col][i]
  remove_at(board[col], i)
  push(board[cols[idx]], item)
  save()
  refresh()
}

fn addTo(col) {
  ask("Yeni kart:", fn(v) {
    if v != nil and trim(v) != "" {
      push(board[col], v)
      save()
      refresh()
    }
  })
}

view {
  HStack(spacing: 12, padding: 14, align: "stretch", grow: true) {
    for col, items in board {
      VStack(spacing: 8, padding: 10, background: "var(--surface-2)", radius: 12, grow: true) {
        HStack {
          Label(col, style: "headline")
          Spacer()
          Badge(str(len(items)))
        }
        for i, card in items {
          HStack(spacing: 6, padding: 8, background: "var(--surface)", radius: 8) {
            Label(card, grow: true)
            Button(icon: "chevronL", variant: "ghost", size: "sm", onClick: fn() { move(col, i, 0 - 1) })
            Button(icon: "chevronR", variant: "ghost", size: "sm", onClick: fn() { move(col, i, 1) })
          }
        }
        Button("+ Kart", variant: "ghost", full: true, onClick: fn() { addTo(col) })
      }
    }
  }
}
`;

const JOURNAL = `app {
  name: "Günlük"
  icon: "note"
  tint: ["#ff375f", "#a8102f"]
  width: 520
  height: 480
}

state entries = store_get("entries", [])
state draft = ""

fn add() {
  if trim(draft) == "" { return }
  unshift(entries, { text: draft, at: now() })
  store_set("entries", entries)
  draft = ""
  refresh()
}

view {
  VStack(spacing: 12, padding: 16, grow: true) {
    Label("Günlük", style: "title")
    TextArea(draft, placeholder: "Bugün ne oldu?", bind: "draft", rows: 4)
    Button("Kaydet", variant: "primary", full: true, onClick: add)
    Label(len(entries) + " kayıt", style: "caption")
    ScrollView(spacing: 8, grow: true) {
      for e in entries {
        Card() {
          Label(date_str(e.at) + " · " + time_str(e.at), style: "caption")
          Label(e.text)
        }
      }
    }
  }
}
`;

const MARKDOWN_PREVIEW = `app {
  name: "Markdown Notu"
  icon: "fileText"
  tint: ["#64d2ff", "#0a84ff"]
  width: 640
  height: 480
}

state text = store_get("md", "# Başlık\\n\\nBu bir **OpenSharp** notu.\\n\\n- madde bir\\n- madde iki")

fn save() {
  store_set("md", text)
  toast("Kaydedildi", "💾")
}

view {
  HStack(spacing: 0, grow: true, align: "stretch") {
    VStack(spacing: 8, padding: 12, grow: true) {
      Label("Kaynak", style: "caption")
      TextArea(text, bind: "text", rows: 18, grow: true)
      Button("Kaydet", variant: "primary", full: true, onClick: save)
    }
    VStack(spacing: 8, padding: 12, grow: true, background: "var(--surface-2)") {
      Label("Önizleme", style: "caption")
      ScrollView(spacing: 6, grow: true) {
        for line in split(text, "\\n") {
          if starts(line, "# ") {
            Label(slice(line, 2), style: "title")
          } elif starts(line, "## ") {
            Label(slice(line, 3), style: "title2")
          } elif starts(line, "- ") {
            Label("•  " + slice(line, 2))
          } elif trim(line) != "" {
            Label(line)
          }
        }
      }
    }
  }
}
`;

export const BUILTIN_CATALOG = [
  { id: 'sayac', name: 'Sayaç', summary: 'State ve düğmeleri gösteren minik örnek.',
    icon: 'plus', tint: ['#5ac8fa', '#0a84ff'], category: 'Örnek', src: () => EXAMPLES['Sayaç.osh'] },
  { id: 'yapilacaklar', name: 'Yapılacaklar', summary: 'Kalıcı depo ile görev listesi.',
    icon: 'check', tint: ['#30d158', '#1a9e45'], category: 'Verimlilik', src: () => EXAMPLES['Yapılacaklar.osh'] },
  { id: 'pomodoro', name: 'Pomodoro', summary: 'Zamanlayıcı, bildirim ve ilerleme çubuğu.',
    icon: 'clock', tint: ['#ff453a', '#c1271e'], category: 'Verimlilik', src: () => EXAMPLES['Pomodoro.osh'] },
  { id: 'renk-atolyesi', name: 'Renk Atölyesi', summary: 'Sistem vurgu rengini uygulamadan değiştirin.',
    icon: 'paint', tint: ['#bf5af2', '#7a30b0'], category: 'Sistem', src: () => EXAMPLES['Renk Atölyesi.osh'] },
  { id: 'sistem-bilgisi', name: 'Sistem Bilgisi', summary: 'OS API’si ve dosya sistemi okuma örneği.',
    icon: 'cpu', tint: ['#8e8e93', '#48484a'], category: 'Sistem', src: () => EXAMPLES['Sistem Bilgisi.osh'] },
  { id: 'birim-cevirici', name: 'Birim Çevirici', summary: 'Sözlükler ve Select bileşeni.',
    icon: 'calc', tint: ['#40c8e0', '#0a7b96'], category: 'Araç', src: () => UNIT },
  { id: 'sifre-uretici', name: 'Şifre Üretici', summary: 'Slider, Toggle ve metin işlemleri.',
    icon: 'lock', tint: ['#30d158', '#0c7a34'], category: 'Araç', src: () => PASSWORD },
  { id: 'zar', name: 'Zar', summary: 'Listeler ve rastgelelik.',
    icon: 'grid', tint: ['#ff9f0a', '#c05a00'], category: 'Eğlence', src: () => DICE },
  { id: 'kanban', name: 'Kanban', summary: 'İç içe döngüler ve kalıcı pano.',
    icon: 'layers', tint: ['#bf5af2', '#6b2494'], category: 'Verimlilik', src: () => KANBAN },
  { id: 'gunluk', name: 'Günlük', summary: 'TextArea, zaman biçimleme ve depolama.',
    icon: 'note', tint: ['#ff375f', '#a8102f'], category: 'Verimlilik', src: () => JOURNAL },
  { id: 'markdown-notu', name: 'Markdown Notu', summary: 'Canlı önizlemeli markdown düzenleyici.',
    icon: 'fileText', tint: ['#64d2ff', '#0a84ff'], category: 'Araç', src: () => MARKDOWN_PREVIEW },
];

export default BUILTIN_CATALOG;
