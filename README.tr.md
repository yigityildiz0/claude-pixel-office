# Claude Code için Piksel Ofis

[English](README.md) | Türkçe

Piksel Ofis (`piksel-ofis`), Claude Code oturumunu yan panelde küçük, canlı bir piksel ofis olarak gösteren bir moddur. Ana model patron masasında oturur, alt ajanlar kendi masalarına geçer, kabuktan başlattığın dış CLI ajanları (Codex, Antigravity, Gemini CLI) da onlara katılır. Her masa, çalışanın o an ne yaptığını işin türüne ve ters giden şeye göre küçük bir animasyonla gösterir.

Uzun ya da paralel Claude Code oturumları yürütenler için: kimin meşgul, kimin takılı olduğunu ve ne kadar kullanım hakkı kaldığını tek bakışta görürsün. Mod hiçbir modeli çağırmaz ve sistem istemine bir şey eklemez; token harcamaz.

**Arayüz metinleri Türkçedir** (sekmeler, düğmeler, konuşma balonları).

```
/plugin install piksel-ofis --marketplace yigityildiz0/claude-pixel-office
```

## Özellikler

- **Paneli kaplayan ofis.** Yerleşim her panel boyuna ve ekip sayısına uyar; yan panel yoktur. Bilgiler ofisin nesnelerindedir:
  - **su sebili** bağlam kullanımını ve otomatik sıkıştırma eşiğini,
  - **batarya**, **duvar saati** ve **takvim** 5 saatlik ve haftalık kullanım hakkını, bitiş tahminiyle,
  - **LED skor tabelası** bugünkü ve bu sohbetteki maliyeti, tur, ajan, araç ve süreyi,
  - **kayan yazı bandı** canlı olay akışını gösterir.
- **Her platforma bir figür.** Üç özgün piksel karakter: Claude Code döngüleri turuncu, Codex yeşil, Antigravity ve Gemini CLI mavi. Patron taçlı turuncu figürdür. Figürü platform seçer; model ve efor masanın panelinde yazar.
- **Yer değiştiren masalar.** Yeni gelen yürüyerek girip ilk boş masaya oturur; biri ayrılınca arkadakiler boşluğu kapatmak için öne yürür. İç içe alt ajanlar kendilerini başlatan masanın altında oturur; görev, mesaj ve raporlar masalar arasında kâğıt uçakla gider.
- **İşe göre animasyonlar.** Son araçlar, görev ve çalışanın durumu masada bir propa dönüşür: resim çizme, hızlı yazma, kod okuma, test koşma, web'de arama, planlama, git işi, yayına alma ve daha fazlası.
- **Hata ve bekleme animasyonları.** Hız sınırı, zaman aşımı, izin bekleme, kopan bağlantı, bağlam taşması, kırılan derleme ve test, kota kilidi gibi durumların her birinin kısa bir animasyonu vardır. Ham hata metni, dosya yolu ve komut asla çizilmez.
- **Kullanım göstergesi ve otomatik sıkıştırma.** Paneldeki ayarlar otomatik sıkıştırmayı açıp kapatır, eşiğini değiştirir (varsayılan: açık, %75). Kardeş [kullanım bandı modu](https://github.com/yigityildiz0/claude-usage-band) (`kota-bandi`) kuruluysa ikisi tek ayarı paylaşır ve yalnız biri sıkıştırır.
- **Cetvel'den dış ajanlar (isteğe bağlı).** [Cetvel](https://github.com/yigityildiz0/burette) masaüstü uygulaması (İngilizce adı: Burette) kuruluysa başka terminal ve uygulamalardaki ajanlar ve alt ajanları da ofiste oturur.
- **Yorgunluk.** Kullanım hakkı azaldıkça ofis yorulur: yavaş yürüyüş, esneme, ter.

## Kurulum

Claude Code 2.1.275 ya da üstü gerekir.

1. Yukarıdaki kurulum satırını Claude Code'da çalıştır.
2. Zaten açık olan sohbetlerde `/reload-plugins` komutunu çalıştır.

Claude masaüstü uygulamasında ve VS Code'da panel oturum başlarken kendiliğinden açılır. Kapatmak için eklenti seçeneği `otomatikAc` değerini `false` yap. Terminalde paneli `/ofis` ile açarsın.

## Kullanım

- `/ofis` paneli yeniden açar.
- Panelde ofis (**Genel**), ekip (**Ekip**) ve bağlam dökümü (**Bağlam**) sekmeleri ile katlanan bir **Ayarlar** bölümü vardır: otomatik sıkıştırma açık/kapalı, eşik −5/+5, şimdi sıkıştır, hareket açık/kapalı ve ipuçları açık/kapalı.
- Ekip sekmesinde bir çalışana tıklamak o ajanın konuşmasını açar.

## Güncelleme ve kaldırma

- Güncellemeyi `/plugin` menüsünden yap ya da `/plugin marketplace update claude-pixel-office` komutunu, ardından `/reload-plugins` komutunu çalıştır.
- Kaldırmak için `/plugin uninstall piksel-ofis`. Ortak ayar klasörü `~/.claude/plugins/data/claude-auto-compact/` yerinde kalır; kullanım bandı modu da kurulu değilse elle silebilirsin.

## Sorun giderme

- **Panel kendiliğinden açılmıyor.** Otomatik açılış yalnız Claude masaüstü uygulamasında ve VS Code'da çalışır. Başka yerde `/ofis` komutunu kullan.
- **`/ofis` bulunamıyor.** Komut oturum başlarken kaydedilir. `/reload-plugins` komutunu çalıştır ya da yeni bir sohbet başlat.
- **Ofis kıpırdamıyor.** **Ayarlar** bölümünü aç, **Hareket** düğmesinin açık olduğunu kontrol et.
- **Dış ajanlar görünmüyor.** Kabuktan başlattığın ajanlar, onları başlatan komuttan algılanır. Başka terminal ve uygulamalardaki ajanlar için Cetvel'in kurulu ve çalışıyor olması gerekir; ofis onun anlık dosyasını okur.
- **Sıkıştırma iki kez ya da hiç çalışmıyor.** Bu mod ile kullanım bandı modundan yalnız biri sıkıştırır; ikisi de aynı ayarı gösterir. Ayarı herhangi birinde kontrol et.

## Gizlilik

- Her şey yerelde çalışır. Mod ağa istek göndermez ve süreç başlatmaz.
- Kabuk komutlarından yalnız türetilmiş bilgiyi tutar: hangi CLI aracının başladığı, modeli, eforu ve korumalı alan kipi. Komut metni, istem ve tam dosya yolu hiçbir yerde saklanmaz ve gösterilmez.
- Varsa okuduğu dosyalar: `~/.codex/config.toml` ve Codex profil dosyaları (yalnız model ve efor), Claude masaüstü uygulamasının ayar dosyası (yalnız tema), Cetvel'in ajan anlığı `%LOCALAPPDATA%\Cetvel\ajanlar.json` (yalnız ajan karması, kısa ad, model, durum ve sayaçlar) ve iş akışı betiği (yalnız model adları).
- Yazdığı dosyalar: paylaşılan otomatik sıkıştırma ayarı; `~/.claude/plugins/data/claude-auto-compact/` altında sohbet başına küçük bir JSON dosyası ve küçük bir "canlı" işaret dosyası.

## Geliştirme

Katkıcılar için notlar [AGENTS.md](AGENTS.md) dosyasındadır. Depo kökünde `claude plugin validate .` ve `claude plugin test .` komutlarının ikisi de geçmelidir.

## İlgili projeler

- [Cetvel](https://github.com/yigityildiz0/burette) (İngilizce adı Burette): ajan anlığı bu modda gösterilebilen masaüstü uygulaması.
- [Kullanım bandı](https://github.com/yigityildiz0/claude-usage-band): komut kutusunun üstündeki kota bandı; otomatik sıkıştırma ayarını paylaşır.
- Yazarın diğer işleri: [github.com/yigityildiz0](https://github.com/yigityildiz0).

## Lisans

[MIT](LICENSE) © Yiğit Yıldız

Karakterler, simgeler ve proplar bu proje için çizilmiş özgün piksel çizimlerdir. Claude, Codex, Antigravity ve Gemini yalnız platform etiketi olarak anılır; bu proje sahipleriyle bağlantılı değildir ve onlar tarafından desteklenmez.
