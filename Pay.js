exports.handler = async (event) => {
  // Autoriser seulement les POST
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Méthode non autorisée" }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ success: false, message: "Requête invalide" }) };
  }

  const { amount, description, orderRef, channel, phone, custName, custPhone } = body;

  // Validation
  if (!amount || !channel || !phone) {
    return {
      statusCode: 400,
      body: JSON.stringify({ success: false, message: "Données manquantes (montant, canal, téléphone)" }),
    };
  }

  // Clés depuis les variables d'environnement Netlify
  const MASTER_KEY  = process.env.PAYDUNYA_MASTER_KEY;
  const PRIVATE_KEY = process.env.PAYDUNYA_PRIVATE_KEY;
  const TOKEN       = process.env.PAYDUNYA_TOKEN;
  const MODE        = process.env.PAYDUNYA_MODE || "test";

  if (!MASTER_KEY || !PRIVATE_KEY || !TOKEN) {
    console.error("Variables d'environnement PayDunya manquantes !");
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, message: "Configuration serveur incomplète. Contactez l'administrateur." }),
    };
  }

  // URL API PayDunya selon le mode
  const baseUrl = MODE === "live"
    ? "https://app.paydunya.com/api/v1"
    : "https://app.paydunya.com/sandbox-api/v1";

  try {
    // ── Étape 1 : Créer la facture PayDunya ──
    const invoiceResp = await fetch(`${baseUrl}/checkout-invoice/create`, {
      method: "POST",
      headers: {
        "Content-Type":          "application/json",
        "PAYDUNYA-MASTER-KEY":   MASTER_KEY,
        "PAYDUNYA-PRIVATE-KEY":  PRIVATE_KEY,
        "PAYDUNYA-TOKEN":        TOKEN,
      },
      body: JSON.stringify({
        invoice: {
          total_amount: amount,
          description:  description || "Commande Nid Gourmand",
        },
        store: {
          name:      "Nid Gourmand",
          tagline:   "Pâtisserie artisanale",
          phone:     custPhone || "",
          postal_address: "Côte d'Ivoire",
          website_url: "https://nid-gourmand.netlify.app",
        },
        actions: {
          cancel_url:  "https://nid-gourmand.netlify.app/#panier",
          return_url:  "https://nid-gourmand.netlify.app/#merci",
          callback_url:"https://nid-gourmand.netlify.app/.netlify/functions/pay-notify",
        },
        custom_data: {
          order_ref:  orderRef,
          cust_name:  custName,
          cust_phone: custPhone,
          channel:    channel,
        },
      }),
    });

    const invoice = await invoiceResp.json();

    if (!invoice.token) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          success: false,
          message: invoice.response_text || "Impossible de créer la facture PayDunya.",
        }),
      };
    }

    // ── Étape 2 : Déclencher le paiement Mobile Money ──
    // Formater le numéro : enlever le 0 initial et ajouter 225 (CI)
    let formattedPhone = phone.replace(/\s/g, "");
    if (formattedPhone.startsWith("0")) formattedPhone = "225" + formattedPhone.substring(1);
    if (!formattedPhone.startsWith("225")) formattedPhone = "225" + formattedPhone;

    // Mapper le canal PayDunya
    const channelMap = {
      MTN_MONEY:  "mtn-ci",
      MOOV_MONEY: "moov-ci",
    };
    const paydunyaChannel = channelMap[channel] || "mtn-ci";

    const payResp = await fetch(`${baseUrl}/softpay/mobile-money`, {
      method: "POST",
      headers: {
        "Content-Type":          "application/json",
        "PAYDUNYA-MASTER-KEY":   MASTER_KEY,
        "PAYDUNYA-PRIVATE-KEY":  PRIVATE_KEY,
        "PAYDUNYA-TOKEN":        TOKEN,
      },
      body: JSON.stringify({
        token:        invoice.token,
        phone_number: formattedPhone,
        channel:      paydunyaChannel,
        provider:     paydunyaChannel,
      }),
    });

    const payResult = await payResp.json();

    // PayDunya envoie une notification USSD au téléphone du client.
    // Le paiement est considéré initié si response_code = "00" ou status = "pending"
    if (
      payResult.response_code === "00" ||
      payResult.status === "pending"   ||
      payResult.status === "completed"
    ) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          token:   invoice.token,
          message: "Paiement initié. Le client doit confirmer sur son téléphone.",
        }),
      };
    } else {
      return {
        statusCode: 400,
        body: JSON.stringify({
          success: false,
          message: payResult.response_text || "Paiement refusé par l'opérateur. Vérifiez le solde.",
        }),
      };
    }

  } catch (err) {
    console.error("Erreur PayDunya :", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, message: "Erreur serveur. Réessayez dans quelques instants." }),
    };
  }
};
