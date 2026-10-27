# Cthulhu Spell Reader

Panel zaklęć dla **Foundry VTT 14** i **Call of Cthulhu 7th Edition (CoC7) 8.16**.

## Instalacja

W **Add-on Modules → Install Module** wklej adres manifestu:

```text
https://raw.githubusercontent.com/Bratkowski/Cthulhu-Spell-Reader/main/module.json
```

Albo skopiuj pliki repozytorium do `Data/modules/cthulhu-spell-reader/`, z `module.json` bezpośrednio w tym folderze. Uruchom ponownie Foundry i włącz moduł w **Manage Modules**.

## Obsługa

- Panel otwiera przycisk książki z czaszką w narzędziach tokenów. Ponowne kliknięcie zamyka panel.
- Można też użyć makra `macros/toggle-spell-reader.js` lub przypisać skrót w ustawieniach klawiatury.
- GM zaznacza token. Gracz korzysta z tokenu przypisanej postaci na aktywnej scenie.
- Karty stykają się krawędziami, bez wspólnej ramki ani tła wokół karuzeli. Wybrana karta powiększa się, a wysokość karuzeli płynnie się dostosowuje. Nazwa leży na przyciemnionym dole grafiki.
- Pod nazwą, CoCID, czasem i typem są zakładki **Opis** (domyślna) i **Koszty**. Przycisk rzucania znajduje się w nagłówku podglądu.
- W rozwiniętym podglądzie zębatka obok **Test Cast** otwiera systemową kartę tego zaklęcia jako przedmiotu należącego do postaci.
- W trybie zwiniętym najechanie na kartę lub ustawienie na niej fokusu pokazuje tooltip: nazwę, czas rzucania, typ, koszty i opis. Można przejść kursorem do tooltipu i przewijać jego treść.
- W trybie zwiniętym pierwsze kliknięcie wybiera kartę, a drugie kliknięcie tej samej karty wykonuje natywny **Test Cast**. Zwykły dwuklik też uruchamia go raz. Po rzuceniu kolejne rzucanie wymaga ponownie dwóch kliknięć.
- PPM przypina podgląd: w trybie zwiniętym tooltip, w rozwiniętym podgląd z zakładkami. Escape, kliknięcie poza podglądem lub X zamyka go.
- Przycisk ⇵ zwija panel do karuzeli. Stan, wybór i wyszukiwanie są zapamiętywane osobno dla użytkownika.

## Rzucanie i koszty — system CoC7

**Test Cast** wywołuje dokładnie `spell.system.cast(true)`, tak jak przycisk „Test Cast” na karcie systemowej CoC7 8.16. Argument `true` oznacza ukrytą wiadomość na czacie. Na zaklęciu należącym do aktora system nadal pobiera z niego koszty; nie jest to symulacja bez zmian zasobów.

Wszystkie okna pytań, zmienne, kości, rozliczanie zasobów i wynik na czacie obsługuje CoC7. Moduł nie wykonuje własnych testów MOC, testów przeciwnych, odejmowania zasobów ani dodatkowych komunikatów na czacie. Nie rozpoznaje celów zaklęć i nie korzysta ze słownika celów.

Zakładka **Koszty** pokazuje `system.costList` w zapisanej kolejności, wraz z warunkami `@variable` / `!@variable`, formułami, pytaniami, grupami dodatkowych rzucających i ustawianiem zmiennych. Podgląd nie wykonuje kroków ani rzutów: wartości zależne od odpowiedzi i kości rozstrzyga system dopiero podczas rzucania.

Jeśli lista kroków jest pusta, panel pokazuje starsze `system.costs`. Zgodnie z zachowaniem CoC7 system raportuje starsze koszty na czacie, bez automatycznego pobierania ich z aktora.

Źródła: [dokumentacja zaklęć CoC7 8.16](https://github.com/Miskatonic-Investigative-Society/CoC7-FoundryVTT/blob/8.16/docs/en/item_spell.md), [obsługa przycisku na karcie](https://github.com/Miskatonic-Investigative-Society/CoC7-FoundryVTT/blob/8.16/coc7/models/item/spell-sheet.js), [nagłówek z Test Cast](https://github.com/Miskatonic-Investigative-Society/CoC7-FoundryVTT/blob/8.16/static/templates/items/spell-header.hbs), [systemowa metoda cast](https://github.com/Miskatonic-Investigative-Society/CoC7-FoundryVTT/blob/8.16/coc7/models/item/spell-system.js).

## Pliki

| Plik | Odpowiedzialność |
| --- | --- |
| `scripts/main.js` | Uruchamianie, hooki, przycisk i API |
| `scripts/spell-dock.js` | Karuzela, tooltipy, zakładki, karta przedmiotu i stan użytkownika |
| `scripts/casting.js` | Wywołanie systemowego Test Cast |
| `scripts/costs.js` | Prezentacja kroków kosztów bez ich wykonywania |
| `scripts/actor.js` | Wybór tokenu i odczyt zasobów |
| `scripts/spells.js` | Typy i CoCID |
| `templates/` | Szablony panelu, podglądu i kosztów |
| `styles/spell-dock.css` | Wygląd, responsywność i animacje |

Moduł nie wymaga budowania ani zależności w Foundry. Testy logiki w Node.js 22+: `npm test`.

Opcjonalny test interfejsu używa Playwright i Handlebars:

```sh
npm install --no-save playwright handlebars
npx playwright install chromium
node tests/browser-smoke.cjs
```

Test korzysta z przykładowych danych i zastępczego API Foundry; sprawdza szablony, stykanie kart, animację, zakładki, tooltipy, podwójne wybranie karty, otwieranie przedmiotu, przekazanie wywołania Test Cast, wyszukiwanie, PPM, wąski ekran oraz sprzątanie zdarzeń.

Pełne sprawdzenie natywnych okien i rozliczenia kosztów należy wykonać w świecie Foundry 14 / CoC7 8.16 na kopii postaci.

API dla makr:

```js
await game.modules.get("cthulhu-spell-reader").api.toggle();
game.modules.get("cthulhu-spell-reader").api.close();
```
