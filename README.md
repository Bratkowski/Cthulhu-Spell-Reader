# Cthulhu Spell Reader

Moduł dla **Foundry VTT 14** i **Call of Cthulhu 7th Edition (CoC7) 8.16**, wydzielony z makra panelu zaklęć.

Wersja 0.1.0 zachowuje karuzelę kart, wyszukiwanie, tryb rozwinięty i zwinięty, panel boczny, podgląd pod prawym przyciskiem myszy, koszty i raport na czacie. Przeszła 9 testów logiki oraz test panelu w przeglądarce z zastępczym API Foundry. Docelowe wersje są ograniczone w manifeście; pełny test w działającym świecie Foundry pozostaje do wykonania.

## Instalacja

W Foundry wybierz **Add-on Modules → Install Module** i wklej adres manifestu:

```text
https://raw.githubusercontent.com/Bratkowski/Cthulhu-Spell-Reader/main/module.json
```

Możesz też skopiować pliki repozytorium do `Data/modules/cthulhu-spell-reader/`, tak aby `module.json` leżał bezpośrednio w tym folderze. Uruchom ponownie Foundry i włącz moduł w **Manage Modules** w świecie CoC7.

## Otwieranie panelu

- Użyj przycisku książki z czaszką w narzędziach tokenów.
- Albo utwórz makro typu **Script** z zawartością `macros/toggle-spell-reader.js` i przeciągnij je na pasek.
- Możesz przypisać skrót w ustawieniach klawiatury Foundry.

GM wybiera zaznaczony token. Gracz korzysta z przypisanej postaci i jej tokenu na aktywnej scenie. Ponowne użycie przycisku lub makra zamyka panel. Rzucanie wymaga uprawnień właściciela aktora.

## Słownik celów

W ustawieniach modułu można zmienić adres słownika JSON. Domyślnie pozostaje adres Forge używany przez oryginalne makro. Puste pole lub niedostępny plik umożliwia ręczny wybór, czy zaklęcie wymaga celu. Ustawienie ręczne i wartość `variable` są dostępne w rozwiniętym panelu.

```json
[
  { "spellName": "i.spell.example", "hasTarget": true },
  { "spellName": "i.spell.other", "hasTarget": false }
]
```

`spellName` oznacza CoCID z `flags.CoC7.cocidFlag.id`. Słownik jest przechowywany w pamięci przez 10 minut. Zmiana adresu czyści pamięć i zamyka panel; otwórz go ponownie, aby pobrać nowy słownik.

## Mechanika zachowana z makra

- Obsługiwane są tekstowe pola `system.costs`: `hitPoints`, `magicPoints`, `sanity`, `power`, `others`. Koszty mogą zawierać liczby, kości, działania i `variable`.
- Koszty są płacone również przy nieudanym teście. Brakujące MP są pobierane z HP. HP, SAN i POW są odejmowane bezpośrednio, tak jak w makrze; nie uruchamia to pełnej obsługi obrażeń i utraty poczytalności systemu.
- Wykonywany jest test 1d100 przeciw MOC rzucającego. Dla zaklęć z celem dochodzi przeciwny test MOC. Zachowano rozstrzyganie remisów z makra: niższy wynik kości, a przy równych wynikach wygrywa rzucający.
- Pole `others` jest tylko raportowane. Opis i raport nie nakładają automatycznie efektów zaklęcia na cel.
- Nowsze automatyczne koszty `system.costList` nie są interpretowane. Dla takich zaklęć panel wyświetla komunikat, aby użyć karty systemowej CoC7, i nie pobiera zasobów.

Stan panelu jest zapisywany osobno dla użytkownika we flagach modułu. Przy pierwszym użyciu odczytywane są też stare ustawienia `world.coc7SpellDockStateV1`. Oryginalny lokalny plik tekstowy nie jest modyfikowany ani publikowany.

## Struktura

| Plik | Odpowiedzialność |
| --- | --- |
| `module.json` | Manifest i zgodność wersji |
| `scripts/main.js` | Hooki, ustawienia, przycisk, skrót i API |
| `scripts/config.js` | Identyfikatory i rozmiary panelu |
| `scripts/spell-dock.js` | Interakcje panelu i zapamiętywanie stanu |
| `templates/spell-dock.hbs` | Główna struktura HTML panelu |
| `styles/spell-dock.css` | Wygląd panelu |
| `scripts/casting.js` | Rzucanie zaklęć, pobieranie zasobów i czat |
| `scripts/costs.js` | Koszty, kości i obliczenia |
| `scripts/checks.js` | Stopnie sukcesu i testy MOC |
| `scripts/actor.js` | Wybór tokenu i zasoby CoC7 |
| `scripts/target-dictionary.js` | Słownik CoCID i pamięć podręczna |
| `scripts/spells.js`, `scripts/utils.js` | Typy zaklęć i funkcje pomocnicze |
| `macros/toggle-spell-reader.js` | Makro na pasek |

## Rozwój i sprawdzanie

Moduł nie wymaga budowania ani zależności w Foundry. Testy logiki uruchomisz w Node.js 22+:

```sh
npm test
```

Przed wydaniem sprawdź w świecie testowym Foundry 14 / CoC7 8.16: otwieranie jako GM i gracz, zamykanie i ponowne otwieranie, wyszukiwanie, oba tryby panelu, PPM, linki i rzuty w opisach, zmianę celu, `variable`, brak MP, raport na czacie i zmianę sceny. Użyj kopii postaci, ponieważ rzucanie zaklęć zmienia jej zasoby.

API dla makr:

```js
await game.modules.get("cthulhu-spell-reader").api.toggle();
game.modules.get("cthulhu-spell-reader").api.close();
```

Punkty odniesienia: [manifest modułu Foundry](https://foundryvtt.com/article/module-development/), [API narzędzi sceny v14](https://foundryvtt.com/api/v14/functions/hookEvents.getSceneControlButtons.html), [model zaklęć CoC7 8.16](https://github.com/Miskatonic-Investigative-Society/CoC7-FoundryVTT/blob/8.16/coc7/models/item/spell-system.js).
