# Spese di Casa: come installarla sul telefono

L'app è una PWA: un sito che, aperto da Chrome su Android, si installa come una normale app. Ha la sua icona, si apre a schermo intero e funziona anche offline. I dati restano solo sul telefono.

Per installarla serve un indirizzo **https**. Il modo più semplice e gratuito è GitHub Pages.

## Pubblicarla con GitHub Pages (una volta sola, circa 5 minuti)

1. Crea un account gratuito su <https://github.com>, se non lo hai.
2. Crea un nuovo repository chiamato, per esempio, `spese` (anche privato va bene se hai un piano che lo permette; altrimenti pubblico: il codice è visibile ma **i tuoi dati no**, restano sul telefono).
3. Nella pagina del repository premi **Add file → Upload files** e trascina tutti i file di questa cartella (`index.html`, `app.js`, `styles.css`, `sw.js`, `manifest.webmanifest` e la cartella `icons`). Conferma con **Commit changes**.
4. Vai su **Settings → Pages**, alla voce *Branch* scegli `main` e la cartella `/ (root)`, poi premi **Save**.
5. Dopo un minuto l'app è online all'indirizzo `https://TUO-UTENTE.github.io/spese/`.

In alternativa puoi trascinare la cartella su <https://app.netlify.com/drop>: ottieni subito un indirizzo https.

## Installarla su Android

1. Apri l'indirizzo con **Chrome** sul telefono.
2. Tocca il menu ⋮ e scegli **Installa app** (oppure **Aggiungi a schermata Home**).
3. Da quel momento la apri dall'icona, come le altre app.

## Backup

I dati sono salvati nella memoria dell'app sul telefono. Se disinstalli l'app, cancelli i dati di Chrome o cambi telefono, i dati si perdono. Ogni tanto, quindi, vai in **Altro → Esporta backup** e salvalo su Google Drive con *Condividi*. Per recuperarli usa **Altro → Ripristina backup**.

## Aggiornamenti

Quando sostituisci i file su GitHub con una nuova versione, l'app si aggiorna da sola alla seconda apertura. I dati non vengono toccati.
