# Claude Code için Piksel Ofis

[English](README.md)

Piksel Ofis (`piksel-ofis`), Claude Code oturumunu yan panelde küçük, canlı bir piksel ofis olarak gösteren bir moddur. Ana model patron masasında oturur, alt ajanlar kendi masalarına geçer, kabuktan başlattığın dış CLI ajanları (Codex, Antigravity, Gemini CLI) da onlara katılır. Her masa, çalışanın o an ne yaptığını işin türüne ve ters giden şeye göre küçük bir animasyonla gösterir.

Mod hiçbir modeli çağırmaz ve sistem istemine bir şey eklemez; token harcamaz.

## Özellikler

- **Paneli kaplayan ofis.** Yerleşim her panel boyuna ve ekip sayısına uyar; yan panel yoktur. Bilgiler ofisin nesnelerindedir:
  - **su sebili** bağlam kullanımını ve otomatik sıkıştırma eşiğini,
  - **batarya**, **duvar saati** ve **takvim** 5 saatlik ve haftalık kullanım hakkını, bitiş tahminiyle,
  - **LED skor tabelası** bugünkü ve bu sohbetteki maliyeti, tur, ajan, araç ve süreyi,
  - **kayan yazı bandı** canlı olay akışını gösterir.
- **Her platforma bir figür.** Üç özgün piksel karakter: Claude Code döngüleri turuncu, Codex yeşil, Antigravity ve Gemini CLI mavi. Patron taçlı turuncu figürdür. Figürü platform seçer; model ve efor masanın panelinde yazar.
- **Yer değiştiren masalar.** Yeni gelen yürüyerek girip ilk boş masaya oturur; biri ayrılınca arkadakiler boşluğu kapatmak için öne yürür. İç içe alt ajanlar kendilerini başlatan masanın altında oturur; görev, mesaj ve raporlar masalar arasında kâğıt uçakla gider.
- **İşe göre animasyonlar.** Son araçlar, görev ve çalışanın durumu masada bir propa dönüşür: resim çizme, hızlı yazma, kod okuma, test koşma, webde arama, planlama, git işi, yayına alma ve daha fazlası.
- **Hata ve bekleme animasyonları.** Hız sınırı, zaman aşımı, izin bekleme, kopan bağlantı, bağlam taşması, kırılan derleme ve test, kota kilidi gibi durumların her birinin kısa bir animasyonu vardır. Ham hata metni, dosya yolu ve komut asla çizilmez.
- **Kullanım göstergesi ve otomatik sıkıştırma.** Paneldeki ayarlar otomatik sıkıştırmayı açıp kapatır, eşiğini değiştirir (varsayılan: açık, %75). Kardeş kullanım bandı modu (`kota-bandi` / `usage-band`) kuruluysa ikisi tek ayarı paylaşır ve yalnız biri sıkıştırır.
- **Cetvel'den dış ajanlar (isteğe bağlı).** Cetvel masaüstü uygulaması (İngilizce adı: Burette) kuruluysa başka terminal ve uygulamalardaki ajanlar ve alt ajanları da ofiste oturur.
- **Yorgunluk.** Kullanım hakkı azaldıkça ofis yorulur: yavaş yürüyüş, esneme, ter.

Arayüz metinleri Türkçedir.

## Kurulum

Claude Code 2.1.275 ya da üstü gerekir.

```
/plugin install piksel-ofis --marketplace yigityildiz0/claude-pixel-office
```

Panel oturum başlarken kendiliğinden açılır. Kapatmak için eklenti seçeneği `otomatikAc` değerini `false` yap.

## Kullanım

- `/ofis` paneli yeniden açar.
- Panelde ofis (**Genel**), ekip (**Ekip**) ve bağlam dökümü (**Bağlam**) sekmeleri ile katlanan bir ayarlar bölümü (otomatik sıkıştırma, eşik −5/+5, şimdi sıkıştır, hareket, ipuçları) vardır.
- Ekip sekmesinde bir çalışana tıklamak o ajanın konuşmasını açar.

## Gizlilik

- Her şey yerelde çalışır. Mod ağa istek göndermez ve süreç başlatmaz.
- Kabuk komutlarından yalnız türetilmiş bilgiyi tutar: hangi CLI'ın başladığı, modeli, eforu ve korumalı alan kipi. Komut metni, istem ve tam dosya yolu hiçbir yerde saklanmaz ve gösterilmez.
- Varsa okuduğu dosyalar: `~/.codex/config.toml` ve Codex profil dosyaları (yalnız model ve efor), Claude masaüstü uygulamasının ayar dosyası (yalnız tema), Cetvel'in ajan anlığı `%LOCALAPPDATA%\Cetvel\ajanlar.json` (yalnız ajan karması, kısa ad, model, durum ve sayaçlar) ve iş akışı betiği (yalnız model adları).
- Yazdığı dosyalar: paylaşılan otomatik sıkıştırma ayarı, `~/.claude/plugins/data/claude-auto-compact/` altında sohbet başına küçük bir JSON dosyası.

## Lisans

[MIT](LICENSE) © Yiğit Yıldız

Karakterler, simgeler ve proplar bu proje için çizilmiş özgün piksel çizimlerdir. Claude, Codex, Antigravity ve Gemini yalnız platform etiketi olarak anılır; bu proje sahipleriyle bağlantılı değildir ve onlar tarafından desteklenmez.
