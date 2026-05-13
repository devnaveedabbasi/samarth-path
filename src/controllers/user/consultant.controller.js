import User from '../../models/User.model.js';
import Consultant from '../../models/Consultant.model.js';
import { ApiError } from '../../utils/errorHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';


export async function submitConsultation(req, res) {
  const userId = req.user._id;
  const { message } = req.body;

  if (!message || message.trim() === '') {
    throw new ApiError(400, 'Message is required.');
  }

  if (message.length > 1000) {
    throw new ApiError(400, 'Message cannot exceed 1000 characters.');
  }

  const now = new Date();

  const startOfMonth = new Date(
    now.getFullYear(),
    now.getMonth(),
    1
  );

  const endOfMonth = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    0,
    23,
    59,
    59
  );

  const monthlyMessages = await Consultant.countDocuments({
    userId,
    sender: 'user',
    createdAt: {
      $gte: startOfMonth,
      $lte: endOfMonth
    }
  });

  if (monthlyMessages >= 3) {
    throw new ApiError(
      400,
      'Monthly consultation limit reached.'
    );
  }

  const consultation = await Consultant.create({
    userId,
    sender: 'user',
    message: message.trim()
  });

  res.status(201).json(
    new ApiResponse(
      201,
      consultation,
      'Consultation submitted successfully.'
    )
  );
}


export async function getMyConsultations(req, res) {
  const userId = req.user._id;

  const consultations = await Consultant.find({ userId, isDeleted: false })
    .sort({ createdAt: 1 });

   const adminReplies = await Consultant.find({ userId, sender: 'admin', isDeleted: false })
     .sort({ createdAt: 1 });
 const senderMessages = await Consultant.find({ userId, sender: 'user', isDeleted: false })
     .sort({ createdAt: 1 });


  res.status(200).json(
    new ApiResponse(
      200,
      { senderMessages, adminReplies },
      'Consultations fetched successfully.'
    )
  );
}


export async function editConsultation(req, res) {
  const userId = req.user._id;
  const { message } = req.body;
  const { consultationId } = req.params;

  if (!message || message.trim() === '') {
    throw new ApiError(400, 'Message is required.');
  }
  const consultation = await Consultant.findOne({
    _id: consultationId,
    userId,
    sender: 'user',
    isDeleted: false
  });

  if (!consultation) {
    throw new ApiError(404, 'Message not found');
  }

  consultation.message = message;
  consultation.editedAt = new Date();

  await consultation.save();

  return res.json(new ApiResponse(200, consultation, 'Message updated'));
}


export async function deleteConsultation(req, res) {
  const { consultationId } = req.params;

  const consultation = await Consultant.findOne({
    _id: consultationId,
    sender: 'user',
    isDeleted: false
  });

  if (!consultation) {
    throw new ApiError(404, 'Not found');
  }

  consultation.isDeleted = true;
  consultation.deletedAt = new Date();

  await consultation.save();

  return res.json(new ApiResponse(200, {}, 'Deleted successfully'));
}