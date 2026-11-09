# Piksel Ofis karakter butcesi (base64 karakter)

Kaynak: `manifest.json`; tüm uzunluklar gerçek PNG dosyalarından ölçüldü. SVG sınırı 131072. Şerit başına ek yük: data öneki 22 + işaretleme/CSS tahmini 260 = 282.

## Karakter x durum

| karakter | kare (w x h) | olcek | ekranda gorunur | idle | walk | wave | work | think | read | wait | done | fail | run | walk_sol | toplam | en buyuk |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| pofu | 36x34 | 2 | 48x48 | 6/688 | 4/688 | 4/608 | 4/656 | 4/680 | 4/632 | 4/668 | 6/844 | 4/824 | 4/736 | - | 7024 | 844 |
| pofu-opus | 36x34 | 2 | 48x48 | 6/768 | 4/752 | 4/648 | 4/724 | 4/652 | 4/604 | 4/708 | 6/828 | 4/856 | - | - | 6540 | 856 |
| pofu-sonnet | 36x34 | 2 | 44x48 | 6/720 | 4/732 | 4/748 | 4/712 | 4/624 | 4/664 | 4/692 | 6/864 | 4/792 | - | - | 6548 | 864 |
| pofu-haiku | 36x34 | 2 | 36x42 | 6/604 | 4/572 | 4/532 | 4/600 | 4/540 | 4/528 | 4/548 | 6/724 | 4/708 | - | - | 5356 | 724 |
| pofu-boss | 36x34 | 2 | 48x48 | 6/720 | 4/700 | 4/688 | 4/656 | 4/664 | 4/636 | 4/704 | 6/796 | 4/824 | - | - | 6388 | 824 |
| gunes | 36x34 | 2 | 52x48 | 6/612 | 4/660 | 4/572 | 4/600 | 4/712 | 4/640 | 4/696 | 6/908 | 4/928 | - | - | 6328 | 928 |
| dunya | 36x34 | 2 | 56x48 | 6/848 | 4/728 | 4/752 | 4/784 | 4/748 | 4/704 | 4/680 | 6/904 | 4/920 | - | - | 7068 | 920 |
| ay | 36x34 | 2 | 54x52 | 6/724 | 4/752 | 4/684 | 4/684 | 4/844 | 4/848 | 4/804 | 6/992 | 4/956 | - | - | 7288 | 992 |
| yildiz | 36x34 | 2 | 48x44 | 6/680 | 4/612 | 4/632 | 4/712 | 4/724 | 4/684 | 4/668 | 6/808 | 4/804 | - | - | 6324 | 808 |
| kristal | 36x34 | 2 | 56x50 | 6/832 | 4/776 | 4/816 | 4/792 | 4/832 | 4/640 | 4/844 | 6/1024 | 4/932 | - | - | 7488 | 1024 |
| evren | 36x34 | 2 | 52x54 | 6/580 | 6/736 | 4/548 | 4/712 | 4/656 | 4/604 | 4/616 | 6/1160 | 6/836 | - | 6/724 | 7172 | 1160 |
| diger | 36x34 | 2 | 52x50 | 6/724 | 4/708 | 4/744 | 4/732 | 4/788 | 4/656 | 4/720 | 6/896 | 4/896 | - | - | 6864 | 896 |

Hücre: kare sayısı / base64 uzunluğu. Şerit sınırı 2500, 6 kareli done 3000; karakter toplamı hedefi 9000.
Hedef asimi (serit): yok.

Azaltma seçeneği: `python -I _arac/uret_acik.py <anahtar> --compact`; yapılandırmadaki palette_compact ve tek benek sadeleştirmesi kullanılır.

## Sahne senaryolari: en cok 8 karakter x 2 durum

| senaryo | karakterler | base64 | +ek yuk | SVG butcesinin % |
|---|---|---|---|---|
| A. idle + work | dunya, kristal, pofu-opus, diger, pofu-sonnet, ay, yildiz, pofu-boss | 11812 | 16324 | %12.5 |
| B. en buyuk iki durum | evren, kristal, ay, gunes, dunya, diger, pofu-opus, pofu | 14704 | 19216 | %14.7 |
| C. tipik ofis work + done (mevcut karakterler) | pofu-boss, pofu-opus, pofu-sonnet, dunya, gunes, ay, yildiz, evren | 12844 | 17356 | %13.2 |

Tüm karakterlerin tüm şeritleri: 80388 base64. Sahnede yalnız aktif durumlar gömülmeli.

## Olcek notu

Ölçek 2, image-rendering:pixelated. Görünür ölçü idle ilk kare alfa kutusudur. Simgeler zaten şerittte; sahnede tekrar çizilmez.
