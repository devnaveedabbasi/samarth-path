import admin from "../config/firebase.js";


const sendNotification = async ({
  token,
  title,
  body,
  data = {},
}) => {
  try {
    const message = {
      token,

      notification: {
        title,
        body,
      },

      data,
    };

    const response = await admin.messaging().send(message);

    console.log("Notification sent:", response);

    return response;
  } catch (error) {
    console.log("FCM Error:", error);
  }
};

export default sendNotification;