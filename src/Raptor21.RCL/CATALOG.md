# Katalog — ne var, nerede, ne zaman kullanılır

Bu dosya bir keşfedilebilirlik aracıdır. Paylaşılan sözlük genelde zaten vardır; sorun katman eksikliği değil,
kimsenin onu bulamamasıdır — aynı kuralı beşinci kez yazmadan önce buraya bakmak bunu önler.

> **Bir şey eklemeden önce buraya bak.** Aradığın şey büyük ihtimalle var.

---

## 1. Nereye yazmalı — üç medyum, üç kural

Üç ayrı stil medyumu var ve **hangisini seçeceğin markup'ı kimin ürettiğine bağlı**, tercihe değil:

| markup'ı kim üretiyor | stil nereye | neden |
|---|---|---|
| `.razor` (sunucu render) | `<Bileşen>.razor.scss` — **scoped** | Blazor `b-xxxxx` scope niteliğini basar, kural yalnız o bileşene uygular |
| JS (`innerHTML`, `createElement`) | global stylesheet | 🔴 **tarayıcının ürettiği markup scope niteliği TAŞIMAZ** — scoped kural asla eşleşmez |
| 3+ ekranda tekrar eden | uygulamanın paylaşılan sözlüğü (aşağı bak) | tek kaynak |

🔴 Bir kuralı yanlış medyuma yazmak "çalışmıyor" değil **sessizce hiçbir şey yapmıyor** demek: elle enjekte
edilen bir panel stilsiz gelir, hata da vermez.

İkinci tuzak: bir child component'e `Class="..."` geçmek işe yaramaz — o sınıf **child'ın** markup'ına iner ve
**child'ın** scope'unu taşır, senin kuralın eşleşmez. Çözüm: sarmalayıcıyı kendi dosyanda render et.

---

## 2. Paylaşılan sözlük — tüketici uygulamanın kendi katmanı

Kütüphane `rg-` önekini sahiplenir. Onun dışında kalan ortak sınıflar tüketici uygulamanın kendi paylaşılan
stylesheet'ine yazılır ve iki kurala uyar:

- **İş/alan terimi geçemez.** Bir sınıfın adı bir iş kavramını anıyorsa (müşteri, sipariş kodu, satış
  organizasyonu …) o sınıf paylaşılan katmana ait değildir; ilgili ekranın kendi scoped dosyasına gider.
- **Kolon genişlikleri paylaşılan katmana yazılmaz.** Her sayfa kendi scoped dosyasında anlamlı bir ad verir
  (`xl:col-span-4` yerine `.sales-hero-col`).

Tipik atomlar — hepsi ada değil gövdeye göre paylaşılır:

| atom | ne yapar |
|---|---|
| satır | `flex` + dikey ortalama |
| bölünmüş satır | satır + `space-between` |
| sayfa ızgarası | 12'li ızgara, tek bir oluk ölçeği |
| sayfa başlığı | başlık / alt başlık / araçlar / eylemler blokları |
| durum hapı | küçük renkli rozet (`success` / `danger` / `info`) |
| panel durumu | yükleniyor / hata / boş — spinner, metin, ikon, yeniden dene |

---

## 3. RCL bileşenleri — `Raptor21.RCL`

Sunucu tarafı Blazor bileşenleri. Bunlar **taşıyıcıdır** (child content alır, davranış taşır); CSS sınıfı
taşıyıcı değildir — ayrım bu.

**Form:** `RaptorInput` · `RaptorTextarea` · `RaptorSelect` · `RaptorCheckbox` · `RaptorSwitch` · `RaptorField`
· `RaptorButton` · `RaptorActionsMenu`

**Yapı:** `RaptorModal` · `RaptorTabs`/`RaptorTab` · `RaptorDropdown` · `RaptorContainer` (iskelet)

**Veri:** `RaptorGrid` · `RaptorColumn` · `RaptorGridRegion` · `RaptorFilter`/`RaptorFilterField`/`RaptorFilterPanel`

**Düzen kabuğu:** `RaptorSidebar` · `RaptorAppRoot`

**Grafik:** `RaptorChart` — konteyner + durum slotları. Grafik **kurmaz**, seçenek **üretmez**.

**Altyapı:** `RaptorStyles` · `RaptorScripts`

### Düzen kabuğu — neyi taşır, neyi taşımaz

`RaptorSidebar` kenar çubuğunun **iskeletidir**, görünüşü değil. Beş yuva alır (`Brand`, `Menu`, `Bottom`,
toggle içeriği, `ScrollId`) ve `hx-preserve="true"` ile boost'lu gezinmede aynı DOM düğümünün korunmasını
garanti eder — kaydırma konumu ve açık/kapalı durumu bu yüzden hayatta kalır. `RaptorAppRoot` boost'lu
takasın hedefi olan `<div id="app-root">`'u üretir ve hiçbir `rg-` sınıfı yaymaz.

İkisi de menü içeriğine, renklere veya markaya karar vermez: renkler, kabuk sınıfları ve menü ağacı host'ta
kalır. Bileşen mekanizmayı (koruma, toggle, portal) taşır, görünüşü çağıran seçer.

⚠️ `Preserve="false"` vermek `hx-preserve`'ü tamamen kaldırır (boş değer yaymaz). Kenar çubuğunun her
gezinmede yeniden kurulmasını istemiyorsan varsayılanı bozma.

### `RaptorChart` — mekanizma bende, yapılandırma sende

apexcharts'ı tembel yükler, örneği kurar, **kaldırıldığında imha eder** ve loading/empty/error arasında geçiş
yapar. Seçenek nesnesi tamamen çağıranındır: grafik `options`'ı tipik olarak kapanış taşır (para birimi
formatter'ları, çekilen veriye indeksleyen eksen etiketleri), JSON bunu serileştiremez ve serileştirilebilir
bir formatlama DSL'i icat etmek çağırana genel bir kalıp dayatmak olurdu.

```razor
<div class="benim-boyut-sinifim">
    <RaptorChart Id="salesChart" Class="rg-chart--fill">
        <Loading><div class="benim-iskeletim"></div></Loading>
        <Empty><div class="widget-empty">Kayıt yok.</div></Empty>
        <Error><div class="widget-empty">Yüklenemedi.</div></Error>
    </RaptorChart>
</div>
```
```ts
await window.raptorChart('salesChart').render(options);
```

🔴 **Üç kural, üçü de sessiz başarısızlık:**

1. **Sayfa boyut sınıfını `Class`'a verme.** O sınıf sayfanın scoped stylesheet'indeyse kural artık eşleşmez —
   markup'ı bileşen üretiyor, sayfanın `b-*` niteliğini taşımıyor. Sayfa sınıfı **dış sarmalayıcıda** kalır,
   bileşene `rg-chart--fill` verilir.
2. **API'yi kurulmadan çağırma.** Sayfa modülün bundle'dan önce çalışabiliyorsa `window.raptorChart` henüz
   yoktur ve `?.` bunu sessizce yutar; `raptor:ready` olayını bekle.
3. **`Loading` slotu varken canvas gizli başlar** — bileşen görünürlüğü çizimden önce açar. Kendi başına
   `hidden` bir konteynere çizdirmeye çalışma: apexcharts 0×0 ölçer ve sonradan yeniden ölçmez.

### `window.raptorProgress` — akan bir işin ilerleme modalı

Uzun süren bir iş (Excel export, toplu içe aktarım) **bir stream tüketirken** ilerleme çubuğu + durum satırı +
uyarı kutusu gösteren modal. Sunucu markup'ı yok — yüzde, satır sayısı ve uyarılar %100 client state olduğu
için `RaptorModal`'ın "imperatif API yok" kuralı bu vakaya uygulanmaz (aynı gerekçe `runtime/confirm.ts`'te de
geçerli). Açtığı şey gerçek bir `.rg-modal`'dır: focus trap, scroll lock, inert, ESC/backdrop, modal stack —
hepsi tek `ModalComponent` implementasyonundan gelir.

```ts
const result = await window.raptorProgress.run({
    title: 'Exporting Excel',
    stream: async function* () {                    // ⬅ fabrika: modal ekrana gelmeden istek uçmasın
        for await (const f of api.getExcel(req)) {
            if (f.kind === 'progress')  yield {kind: 'progress', processed: f.rowsProcessed, total: f.totalResultCount};
            if (f.kind === 'completed') yield {kind: 'done', processed: f.rowsProcessed, downloadUrl: f.downloadUrl};
        }
    },
    autoCloseMs: 800,                               // 0 = kendi kapanma
});
```

🔴 **Kütüphanenin sözlüğü senin DTO'n değildir.** Frame'ler `total` / `progress` / `warning` / `error` / `done`;
`RowsProcessed`/`FileId` gibi wire alanlarını **çağıran** eşler. Aynı kural `raptorGrid.state()`'te de yazılı:
kütüphane tüketicinin wire format'ını öğrenmez.

⚠️ **Hata fırlatmaz, gösterir.** Stream throw ederse mesaj modalda kalır ve `result.error` dolar — çağıranın
etrafına yazdığı `catch`'e güvenilmez. `run()` **stream bitince** çözülür, kapanma animasyonunu beklemez.

⚠️ **Kapatmak işi iptal etmez.** ESC/backdrop/× ile kapatılan modalın arkasında stream sürer ve dosya yine
iner. İptal isteniyorsa `AbortSignal` çağıranın işidir.

⚠️ **Blazor'da `RaptorFile` YOK.** Form kit'in dosya kontrolü bir TagHelper'dır ve yalnız `.cshtml`'den
kullanılabilir. Blazor tarafında dosya girdisi:
`<input type="file" class="rg-file">` + handler'da `await HttpContext.Request.ReadFormAsync(ct)`
(`RaptorPage` binder'ı `IFormFile` bağlayamaz).

### `window.raptorNotify` — toast + modal-bağımsız onay

Kısa sonuç bildirimi (kaydedildi / silindi / kısmen içe aktarıldı) ve **açık bir modalın üstüne** çizilebilen
Promise tabanlı onay kutusu. Bundle tarafından **eager** kurulur — yani sayfa modülü çalışmadan önce hazırdır,
`?.` ile çağırmak gerekmez (`raptor21.d.ts` bu yüzden opsiyonel değil).

```ts
window.raptorNotify.success('Slider approved successfully.');
window.raptorNotify.error('Import failed.', {title: 'Excel', items: skippedIds});  // items ⇒ toast yapışkan
const ok = await window.raptorNotify.confirm({title: 'Clear all', message: '…', type: 'danger'});
```

Varsayılan bekleme süreleri tipe bağlı: success 4s · info 5s · warning 6s · **error 0 (kullanıcı kapatana
kadar)**. `items` verilirse süre yine 0 olur — okunacak bir liste kendi kendine kaybolmamalı.

🔴 **`confirm()` `hx-confirm`'in diyaloğu DEĞİLDİR.** `runtime/confirm.ts` gerçek bir `.rg-modal` açar ve modal
stack'ine katılır; bu ise imperatif kurulur ve **zaten açık bir modalın üstünde** durabilmek zorundadır
(z-index 2147483600).

⚠️ **Yüzeyler `document.body`'nin çocuğudur, bir modal konteynerinin değil.**
`ModalComponent.applyInertBelow()` `document.body.children` üzerinde gezip en üstteki diyaloğu içermeyen her
çocuğu `inert` işaretler, dolayısıyla bir modal açıkken toast yığını (o an zaten duruyorsa) inert olur.

⚠️ **İkon adı olduğu gibi sınıf olarak basılır** (`RaptorButton`'ın `Icon` parametresiyle aynı sözleşme): glif
host'un ikon font'undan gelir, kütüphane yalnızca adını yazar.

### RCL global sınıfları (`.rg-*`)

`rg-btn` ailesi (`-primary/-success/-danger/-light/-ghost/-outline/-sm/-lg/-icon/-spin`) · `rg-modal` ailesi ·
`rg-cardrow` ailesi (mobil kart satırı) · `rg-input`/`rg-select`/`rg-check`/`rg-file` · `rg-actions-*` ·
`rg-dd-*` (dropdown/bottom-sheet) ·
`rg-progress` ailesi (`-status`/`-track`/`-bar`/`-meta`/`-warn` — `window.raptorProgress` modalının gövdesi) ·
`rg-toast` ailesi (`-stack`/`__row`/`__icon`/`__body`/`__title`/`__message`/`__items*`/`__close`/`__copy`) ve
`rg-ask` ailesi (`-overlay`/`__row`/`__icon`/`__body`/`__title`/`__message`/`__footer`/`__btn*`) —
`window.raptorNotify`'ın gövdesi. Paleti **literal** gri/yeşil/kırmızı/amber/mavi, `--rg-*` token'ları değil:
toast marka aksanını izlemeyen düz bir durum yüzeyidir.

🔴 **`rg-` önekiyle oynama.** `Client/src/styles/_tokens.scss`'te `[class^='rg-'][hidden]{display:none!important}`
kuralı var — **sınıf önekine bağlı**. Toplu yeniden adlandırma portallanmış panellerin gizlenmesini sessizce kırar.

---

## 4. Terfi eşiği

Bir şeyin paylaşılan sözlüğe girmesi için **üçü birden**:

1. **3+ ekranda ölçülmüş** tekrar (tahmin değil — gövdeleri karşılaştır)
2. adında **sıfır** iş/alan terimi
3. literal `#id` / `hidden` bağı yok

Ölçmeden terfi etme. Ama daha önemlisi: **"benziyor" diye yeniden kullanma.** Yeniden kullanım gibi görünen
hamle sık sık görsel değişiklik çıkar:

- ortak kural, çağıranlarda bulunmayan ek bildirimler taşıyor (`gap`, `flex-wrap` …)
- yeni sınıf mevcut olanın ardından geliyor, kazanıyor ve padding/ağırlık değişiyor
- iki sınıf light temada aynı, dark temada farklı

Her seferinde **bildirim bildirim karşılaştır**, ada bakma.

---

## 5. Utility katmanı yok

Kütüphane hiçbir utility framework'ü paketlemez ve host'ta bir tane bulunduğunu varsaymaz. Donmuş ya da kısmi
bir utility katmanı varsa, markup'a yazdığın tanımsız bir utility **sessizce hiçbir şey yapmaz** — yeni stil
semantik CSS olarak yazılır.

Aynı şey ikon fontları için de geçerli: kütüphane yalnızca ikon adını sınıf olarak basar, glifi host sağlar.
