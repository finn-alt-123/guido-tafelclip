# guido. tafelclip — versie 3 (test in het café)

Een klant houdt zijn gsm tegen de NFC-chip in de tafelklem en kan dan:

- **de ober roepen**, met één tik;
- **afrekenen vragen**: met de kaart of contant, samen of apart;
- een **verzoekje** sturen (liedje, kaarsje, karafje water…);
- de **wifi-code**, **mededelingen** en tips **in de buurt** zien.

Bestellen en betalen gebeuren bewust niet via de gsm. Dat blijft aan tafel, zodat het personeel het overzicht houdt.

Het personeel ziet elke oproep op de **iPad aan de bar**: als melding bovenaan het scherm (ook terwijl de kassa open staat) en in de lijst **Meldingen**. Er is geen koppeling met de kassa nodig.

---

## Wat is er veranderd tegenover versie 2

| Weg | Waarom |
|---|---|
| Rekening tonen, betalen, splitsen, Mollie | guido. wil zelf zien wie betaald heeft |
| Koppeling met Lightspeed | toegang is enkel voor partners; niet nodig voor deze test |
| Tabbladen Betalingen en Koppelingen, test-kassa, prijslijst | niet meer nodig |

| Nieuw | |
|---|---|
| Knop **Afrekenen** | de klant vraagt de rekening, jij komt met de terminal of wisselgeld |
| Ober roepen in **één tik** | de reden kiezen kan daarna, hoeft niet |
| **Openingsuren** | buiten de uren kan niemand roepen |
| **Wifi-code** | naam en wachtwoord, met kopieerknop |
| **NL / EN-schakelaar** | rechtsboven op het klantscherm. Start in het Nederlands op een Nederlandstalige gsm, anders in het Engels; de keuze wordt onthouden. Eigen teksten (welkomtekst, verzoekjes, mededelingen) blijven zoals je ze typte. |
| Tabblad **Cijfers** | hoe vaak de clips gebruikt worden en hoe vlug er gereageerd wordt |
| Herhaald belletje | wacht een tafel langer dan 2 minuten, dan belt de iPad opnieuw |
| Lettertypes op de eigen site | niets wordt nog bij Google opgehaald (privacy, en sneller) |
| Minder serververkeer | het klantscherm ververst enkel vlug zolang er een oproep loopt |

Bestaande instellingen, logins, tafels en gekoppelde chips blijven werken na de update.

---

## Bijwerken (je site staat al online)

1. Open je repository op **github.com**.
2. Verwijder in de map `guido-tafelclip` deze twee bestanden, als ze er nog staan: `netlify/lib/lightspeed.mjs` en `netlify/lib/mollie.mjs`.
3. Klik **Add file → Upload files** en sleep de **inhoud** van de nieuwe map erin, in dezelfde map als de vorige keer. Let op de nieuwe map `fonts`. Klik **Commit changes**.
4. Netlify zet alles binnen een minuut online. Controle: `https://<jouw-site>/api/state?ping=1` toont `{"ok":true,"versie":"3.0"}`.
5. Op de iPad: sluit de app *guido.* helemaal af en open ze opnieuw.

## Nieuw opzetten (nog niets online)

1. Maak een gratis account op **github.com** → **New repository** → naam `guido-tafelclip` → **Private** → *Create*.
2. Klik **uploading an existing file** en sleep de **inhoud** van deze map erin (bestanden én de mappen `css`, `fonts`, `img`, `js`, `netlify`). Klik **Commit changes**.
3. Ga naar **app.netlify.com** → *Add new project* → **Import an existing project** → **GitHub** → kies de repository → **Deploy**. Netlify leest alles uit `netlify.toml`.
4. **Zet de beveiliging van Netlify uit**: *Project configuration → Access & security → Visitor access* → publiek. Anders ziet iedereen een wit scherm.
5. *Project configuration → Environment variables* → voeg `GUIDO_SETUP_CODE` toe met een lange geheime zin. Daarna **Deploys → Deploy project**.
6. Open `https://<jouw-site>/beheer.html`, geef de opstartcode, je naam en een pincode. Je bent nu **eigenaar**.

---

## De test in het café: enkel de iPad aan de bar

### Eén keer instellen (15 minuten)

1. **Personeel** → voeg een account **Bar** toe met een pincode (rol *Personeel*). Dat account ziet enkel Meldingen.
2. Op de **iPad**: open `https://<jouw-site>/beheer.html` in **Safari** → **Deel → Zet op beginscherm**.
3. Open **guido.** vanaf het beginscherm en meld je aan als *Bar*.
4. Tik bij *Meldingen op dit toestel* op **Zet aan** → **Sta toe**.
5. iPad: **Instellingen → Meldingen → guido.** → zet de stijl op **Blijvend** en het geluid aan. Dan blijft elke melding staan tot iemand ze aantikt.
6. Test: **Instellingen → Testmelding naar alle toestellen** (als eigenaar, op je laptop).

### Zo werkt het aan de bar

- De kassa blijft gewoon open. Bij een oproep verschijnt bovenaan een melding: *Tafel 5 roept de ober* of *Tafel 2 wil afrekenen · Met de kaart · apart*.
- Tik op de melding: de app opent op de lijst. **Ik kom eraan** laat de klant zien dat er iemand onderweg is. **Klaar** haalt de oproep weg.
- Wie het langst wacht, staat bovenaan. Na 2 minuten wordt de wachttijd rood en belt de iPad opnieuw (als de app open staat).

### Wat de iPad niet kan (en de latere app wel)

- Een knop **in** de melding zelf. Je moet de melding aantikken en dan in de app op de knop tikken.
- Een melding laten verdwijnen als de oproep al afgehandeld of geannuleerd is.
- Trillen op een Apple Watch met een antwoordknop.

Dat kan enkel met een echte app uit de App Store. Die bouwen we pas als de test goed uitdraait.

### Wat je bijhoudt

Het tabblad **Cijfers** telt per avond: hoe vaak de ober geroepen werd, hoe vaak afrekenen, hoeveel verzoekjes, hoeveel annuleringen en de gemiddelde reactietijd. Je kan alles downloaden als tabel. Vraag daarnaast na een week aan het personeel wat hen stoorde.

---

## De clips

- **Tafels & clips** → kies een tafel → kopieer de link en schrijf ze op de chip (bv. met de gratis app **NFC Tools**: Schrijven → Record toevoegen → URL).
- Test op de echte tafels: metaal stoort NFC. Neem dan een *on-metal*-chip.
- **Zonder beveiliging** kan wie de link van een tafel kent, van thuis uit de ober roepen. Voor een eerste test met een paar tafels is dat aanvaardbaar: er zijn limieten per tafel, en een oproep kost niets. Voor echt gebruik neem je beveiligde chips.

### Beveiligde chips (NTAG 424 DNA)

Elke tik maakt een unieke, versleutelde link. Een kopie of een oude link werkt niet.

1. Bestel NTAG 424 DNA-chips.
2. Maak een geheime sleutel van 32 hexadecimale tekens (0-9, A-F) en bewaar ze in een wachtwoordmanager. Vul ze in bij **Instellingen → Beveiligde chips**.
3. Stel de chips in ("SUN / SDM") met dit sjabloon: `https://<jouw-site>/?t=1&e=<PICCData>&c=<CMAC>`, met *PICCData versleuteld (UID + teller)* en *CMAC over lege invoer*. Laat de leverancier dat doen, of gebruik **NXP TagWriter** (Android).
4. **Tafels & clips** → kies de tafel → **Koppel een chip aan deze tafel** → tik binnen 3 minuten de chip aan.
5. Alle tafels gekoppeld? Zet **Klanten moeten de clip echt aantikken** aan.

---

## Wat je instelt als eigenaar

| Tabblad | Wat |
|---|---|
| **Knoppen & uren** | welkomtekst, logo, openingsuren, ober roepen, afrekenen, verzoekjes, wifi. Elke knop kan aan of uit. |
| **Mededelingen** | eigen events en acties. Verdwijnen vanzelf na de datum. |
| **In de buurt** | tips uit de buurt. Optioneel automatisch via agenda's van bevriende zaken of de UiTdatabank (± €125 per jaar, sleutel bij Instellingen). |
| **Tafels & clips** | tafels, links voor de chips, beveiligde chips koppelen. |
| **Personeel** | een login per persoon. *Uitzetten* meldt iemand meteen overal af. |
| **Instellingen** | status, chipbeveiliging, reservekopie. |

Op een breed scherm zie je rechts altijd een live voorbeeld van het klantscherm.

## Bescherming tegen misbruik

- Per tafel: één open oproep en één open afrekenvraag tegelijk; een instelbare wachttijd tussen twee oproepen; maximaal 4 verzoekjes per 10 minuten.
- In het hele café: maximaal 60 klantmeldingen per 10 minuten. Daarna vraagt het scherm om het aan de bar te vragen.
- Buiten de openingsuren kan niemand iets sturen.
- Na 5 foute pincodes is een naam 10 minuten geblokkeerd.
- Klanten zien nooit meldingen van andere tafels, namen van personeel of instellingen.

## Kosten

Alles draait op de gratis plannen van GitHub en Netlify. Het klantscherm vraagt de server enkel vlug om nieuws zolang er een oproep loopt (elke 4 tellen), anders één keer per minuut. De iPad kijkt elke 12 tellen als meldingen aan staan en ze zichtbaar is, en niet als de kassa op de voorgrond staat. Hou in de eerste weken het verbruik in het oog bij **Netlify → Usage**.

## Bewaking (optioneel)

Maak een gratis monitor op **uptimerobot.com** voor `https://<jouw-site>/api/health`, elke 5 minuten. Die pagina meldt een fout als de server meer dan 3 uur niets van zich liet horen.

## Noodplan

Valt de site of het internet uit, dan werkt de kassa gewoon verder en roepen klanten zoals vroeger. Het klantscherm zegt dan dat er geen verbinding is.

## Privacy

Er worden geen namen of accounts van klanten bewaard. Meldingen verdwijnen na 24 uur; van de cijfers blijven enkel aantallen per dag over. Lettertypes en iconen staan op de eigen site: er gaat niets naar derden. Zet een korte privacytekst op de website van guido.: de tafelclip verwerkt enkel het tafelnummer en de tekst van verzoekjes.

## Bestanden

| Bestand | Wat |
|---|---|
| `index.html`, `js/gast.js` | Klantscherm (wat de chip opent) |
| `beheer.html`, `js/beheer.js` | Meldingen voor het personeel en beheer voor de eigenaar |
| `js/core.js` | Gedeelde regels: oproepen, limieten, openingsuren, rechten, cijfers |
| `js/store.js` | Verbinding met de server (of lokale demo) |
| `sw.js`, `manifest.webmanifest`, `img/`, `fonts/` | App op het beginscherm, pushmeldingen, logo, lettertypes |
| `netlify/functions/api.mjs` | Server: logins, chips, meldingen |
| `netlify/functions/onderhoud.mjs` | Elk uur: events ophalen, teken van leven |
| `netlify/lib/` | Opslag, logins, pushmeldingen, chipcontrole, events |
