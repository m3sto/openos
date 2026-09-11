/* ==========================================================================
   OpenOS · seed.js — the filesystem that ships with a fresh install
   ========================================================================== */

import vfs, { VFS } from './vfs.js';

export const EXAMPLES = {
  'Sayaç.osh': `# Sayaç — OpenSharp'a hızlı bir giriş
app {
  name: "Sayaç"
  icon: "plus"
  tint: ["#5ac8fa", "#0a84ff"]
  width: 360
  height: 340
}

state count = 0
state step = 1

fn bump(n) {
  count = count + n
}

view {
  VStack(spacing: 18, padding: 26, align: "center", grow: true, justify: "center") {
    Label("Sayaç", style: "title")
    Label("\${count}", style: "display", tint: "var(--accent)")

    HStack(spacing: 10) {
      Button("−", size: "lg", onClick: fn() { bump(0 - step) })
      Button("+", size: "lg", variant: "primary", onClick: fn() { bump(step) })
    }

    Label("Adım: \${step}", style: "caption")
    Slider(value: step, min: 1, max: 10, step: 1, bind: "step")

    if count > 20 {
      Badge("Rekor! 🎉", color: "green")
    }

    Button("Sıfırla", variant: "ghost", onClick: fn() { count = 0 })
  }
}
`,

  'Yapılacaklar.osh': `# Yapılacaklar — kalıcı depolama ve listeler
app {
  name: "Yapılacaklar"
  icon: "check"
  tint: ["#30d158", "#1a9e45"]
  width: 420
  height: 520
}

state items = store_get("items", [])
state draft = ""

fn save() {
  store_set("items", items)
}

fn addItem() {
  if len(trim(draft)) == 0 { return }
  push(items, { text: trim(draft), done: false })
  draft = ""
  save()
  refresh()
}

fn toggle(i) {
  items[i].done = not items[i].done
  save()
  refresh()
}

fn removeItem(i) {
  remove_at(items, i)
  save()
  refresh()
}

fn remaining() {
  return len(filter(items, fn(it) { return not it.done }))
}

view {
  VStack(spacing: 12, padding: 16, grow: true) {
    HStack(spacing: 8) {
      Label("Yapılacaklar", style: "title")
      Spacer()
      Badge("\${remaining()} kaldı")
    }

    HStack(spacing: 8) {
      TextField(draft, placeholder: "Ne yapılacak?", bind: "draft", onSubmit: fn(v) { addItem() }, grow: true)
      Button("Ekle", variant: "primary", onClick: addItem)
    }

    if len(items) == 0 {
      Empty("Henüz görev yok", glyph: "🌤️")
    }

    ScrollView(spacing: 6, grow: true) {
      for i, it in items {
        HStack(spacing: 10, padding: 8, background: "var(--surface-2)", radius: 10) {
          Checkbox(it.text, value: it.done, onChange: fn(v) { toggle(i) })
          Spacer()
          Button(icon: "trash", variant: "ghost", size: "sm", onClick: fn() { removeItem(i) })
        }
      }
    }

    if len(items) > 0 {
      Button("Tamamlananları temizle", variant: "tinted", full: true, onClick: fn() {
        items = filter(items, fn(it) { return not it.done })
        save()
        refresh()
      })
    }
  }
}
`,

  'Pomodoro.osh': `# Pomodoro — zamanlayıcılar ve bildirimler
app {
  name: "Pomodoro"
  icon: "clock"
  tint: ["#ff453a", "#c1271e"]
  width: 340
  height: 400
}

state left = 25 * 60
state running = false
state mode = "odak"
state ticker = nil

fn fmt(s) {
  let m = floor(s / 60)
  let r = s % 60
  return pad(m, 2) + ":" + pad(r, 2)
}

fn tick() {
  if not running { return }
  left = left - 1
  if left <= 0 {
    running = false
    cancel(ticker)
    notify("Pomodoro", mode == "odak" ? "Mola zamanı!" : "Tekrar odaklan!", "clock")
    mode = mode == "odak" ? "mola" : "odak"
    left = mode == "odak" ? 25 * 60 : 5 * 60
  }
  refresh()
}

fn toggle() {
  running = not running
  if running {
    ticker = every(1000, tick)
  } else {
    cancel(ticker)
  }
}

fn reset() {
  running = false
  cancel(ticker)
  left = mode == "odak" ? 25 * 60 : 5 * 60
}

view {
  VStack(spacing: 20, padding: 26, align: "center", justify: "center", grow: true) {
    Badge(upper(mode), color: mode == "odak" ? "red" : "green")
    Label(fmt(left), style: "display")
    Progress(value: mode == "odak" ? (1 - left / 1500) * 100 : (1 - left / 300) * 100, width: 200)

    HStack(spacing: 10) {
      Button(running ? "Duraklat" : "Başlat", variant: "primary", size: "lg", onClick: toggle)
      Button("Sıfırla", size: "lg", onClick: reset)
    }
  }
}
`,

  'Renk Atölyesi.osh': `# Renk Atölyesi — sistem ile konuşan bir uygulama
app {
  name: "Renk Atölyesi"
  icon: "paint"
  tint: ["#bf5af2", "#7a30b0"]
  width: 480
  height: 440
}

state palette = ["#0a84ff", "#bf5af2", "#ff375f", "#ff9f0a", "#30d158", "#64d2ff", "#5e5ce6", "#ac8e68"]
state picked = os_accent()

fn apply(c) {
  picked = c
  os_accent(c)
  toast("Vurgu rengi güncellendi", "🎨")
  refresh()
}

fn randomColor() {
  let hex = "0123456789abcdef"
  let out = "#"
  for i in 6 {
    out = out + char_at(hex, random(16))
  }
  return out
}

view {
  VStack(spacing: 16, padding: 20, grow: true) {
    Label("Renk Atölyesi", style: "title")
    Label("Seçtiğiniz renk tüm sisteme uygulanır.", style: "callout")

    Grid(columns: 4, gap: 10) {
      for c in palette {
        VStack(spacing: 6, align: "center") {
          Button("", background: c, height: 54, radius: 14, full: true, onClick: fn() { apply(c) })
          Label(c, style: "caption")
        }
      }
    }

    HStack(spacing: 8) {
      Button("Rastgele renk", variant: "primary", onClick: fn() {
        let c = randomColor()
        push(palette, c)
        apply(c)
      })
      Button("Maviye dön", onClick: fn() { apply("#0a84ff") })
      Spacer()
      Badge(picked)
    }

    Card("Şu anki tema") {
      HStack(spacing: 10) {
        Button("Açık", onClick: fn() { os_theme("light") })
        Button("Koyu", onClick: fn() { os_theme("dark") })
        Button("Otomatik", onClick: fn() { os_theme("auto") })
      }
    }
  }
}
`,

  'Sistem Bilgisi.osh': `# Sistem Bilgisi — dosya sistemi ve OS API'si
app {
  name: "Sistem Bilgisi"
  icon: "cpu"
  tint: ["#8e8e93", "#48484a"]
  width: 460
  height: 420
}

state info = os_info()
state files = fs_list(fs_home())

view {
  ScrollView(spacing: 14, padding: 18) {
    HStack(spacing: 12) {
      Icon("logo", size: 34, tint: "var(--accent)")
      VStack(spacing: 2) {
        Label("\${info.name} \${info.version}", style: "title2")
        Label("OpenSharp çalışma zamanı", style: "caption")
      }
    }

    Section("Sistem") {
      ListItem("Tema", value: info.theme, glyph: "moon", tint: "var(--indigo)")
      ListItem("Vurgu rengi", value: info.accent, glyph: "paint", tint: "var(--purple)")
      ListItem("Kullanıcı", value: os_user(), glyph: "user", tint: "var(--blue)")
      ListItem("Uygulama sayısı", value: str(len(os_apps())), glyph: "apps", tint: "var(--green)")
    }

    Section("Ana klasör") {
      for f in files {
        ListItem(f.name, subtitle: f.type == "dir" ? "klasör" : str(f.size) + " bayt",
                 glyph: f.type == "dir" ? "folder" : "file",
                 tint: f.type == "dir" ? "var(--blue)" : "var(--gray)")
      }
    }

    Button("Yenile", variant: "tinted", full: true, onClick: fn() {
      files = fs_list(fs_home())
      info = os_info()
      refresh()
    })
  }
}
`,
};

const README = `# OpenOS

Tarayıcıda çalışan, tamamen istemci taraflı sanal bir işletim sistemi.

## Neler var?
- Pencere yöneticisi (sürükle, boyutlandır, kenara yapıştır, tam ekran)
- Dock, Launchpad, Spotlight, Mission Control, Kontrol Merkezi
- Sanal dosya sistemi (localStorage üzerinde kalıcı)
- **OpenSharp** — uygulama yazmak için tasarlanmış küçük bir betik dili
- Yapay zekâ ajanları için makine arayüzü: \`window.OpenOS\`

## Kısayollar
- ⌘/Ctrl + Boşluk — Spotlight
- F4 — Launchpad, F3 — Mission Control
- ⌘/Ctrl + W — pencereyi kapat, ⌘/Ctrl + M — küçült
- ⌘/Ctrl + \` — pencereler arasında geçiş

## OpenSharp
\`Projeler\` klasöründeki örnekleri OpenSharp Studio ile açıp
çalıştırabilir, düzenleyip Dock'a kurabilirsiniz.
`;

const WELCOME = `Merhaba!

OpenOS'a hoş geldiniz. Bu, tarayıcınızda çalışan tam bir masaüstü ortamı.

Başlamak için:
  · Dock'taki Studio simgesine tıklayın ve kendi uygulamanızı yazın
  · Terminal'i açıp "help" yazın
  · Spotlight'ı (⌘/Ctrl + Boşluk) deneyin

İyi eğlenceler.
`;

/** Creates the standard tree for a brand-new install. */
export function seedFilesystem(user = 'user') {
  const home = VFS.join('/Users', user);
  vfs.home = home;

  ['/System', '/System/Library', '/Applications', '/var', '/var/log', '/Users/shared/.appdata',
   home, home + '/Masaüstü', home + '/Belgeler', home + '/İndirilenler',
   home + '/Resimler', home + '/Müzik', home + '/Projeler', home + '/.Trash',
  ].forEach(p => vfs.mkdir(p));

  vfs.write(VFS.join(home, 'Belgeler/README.md'), README);
  vfs.write(VFS.join(home, 'Masaüstü/Hoş geldiniz.txt'), WELCOME);
  vfs.write(VFS.join(home, 'Belgeler/notlar.txt'), 'Fikirler:\n- OpenSharp ile bir oyun yaz\n- Duvar kâğıdı üret\n');
  vfs.writeJSON(VFS.join(home, 'Belgeler/ayarlar-yedegi.json'), { tema: 'auto', surum: 1 });

  for (const [name, src] of Object.entries(EXAMPLES))
    vfs.write(VFS.join(home, 'Projeler', name), src);

  vfs.write('/System/version', 'OpenOS 1.0.0 "Meridian"\nOpenSharp 1.0\n');
  vfs.write('/var/log/system.log', `[${new Date().toISOString()}] system: first boot completed\n`);
  vfs.persist();
  return home;
}

/** Make sure the expected folders exist on an already-seeded install. */
export function ensureTree(user = 'user') {
  const home = VFS.join('/Users', user);
  vfs.home = home;
  [home, home + '/Masaüstü', home + '/Belgeler', home + '/Projeler', home + '/.Trash',
   '/Applications', '/Users/shared/.appdata', '/var/log'].forEach(p => { if (!vfs.exists(p)) vfs.mkdir(p); });
  return home;
}
