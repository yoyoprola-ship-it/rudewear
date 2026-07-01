// Empty service worker — el subdomain rudewear no lo usa, pero un
// browser que visitó lafayettelamarket.com antes puede tener un SW
// cacheado que intenta re-registrarse acá. Devolvemos 200 vacío para
// evitar el 404 en logs. Este file NO se registra en runtime.
