import User from '../../models/User.model.js';
import Consultant from '../../models/Consultant.model.js';
import { ApiError } from '../../utils/errorHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';

export async function getAllConsultations(req, res) {

  const consultations = await Consultant.find({ isDeleted: false })
    .populate('userId', 'name email phone profilePicture')
    .sort({ createdAt: 1 });

  res.status(200).json(
    new ApiResponse(
      200,
      consultations,
      'All consultations fetched successfully.'
    )
  );
}


export async function replyConsultation(req, res) {
  const { userId, reply } = req.body;

  if (!userId || !reply || reply.trim() === '') {
    throw new ApiError(400, 'User ID and reply message are required.');
  }

  const user = await User.findById(userId);
  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  const consultation = await Consultant.create({
    userId,
    sender: 'admin',
    message: reply.trim()
  });

  return res.status(201).json(
    new ApiResponse(201, consultation, 'Reply sent successfully')
  );

}

export async function updateReply(req, res) {
  const { consultationId } = req.params;
  const { reply } = req.body;

  if (!reply || reply.trim() === '') {
    throw new ApiError(400, 'Reply is required.');
  }

  const consultation = await Consultant.findOne({
    _id: consultationId,
    sender: 'admin',
    isDeleted: false
  });

  if (!consultation) {
    throw new ApiError(404, 'Reply message not found');
  }

  consultation.message = reply.trim();
  consultation.editedAt = new Date();

  await consultation.save();

  return res.json(
    new ApiResponse(200, consultation, 'Reply updated successfully')
  );
}

export async function deleteConsultation(req, res) {
  const { consultationId } = req.params;

  const consultation = await Consultant.findOne({
    _id: consultationId,
    isDeleted: false
  });

  if (!consultation) {
    throw new ApiError(404, 'Not found');
  }

  consultation.isDeleted = true;
  consultation.deletedAt = new Date();

  await consultation.save();

  return res.json(
    new ApiResponse(200, {}, 'Deleted successfully')
  );
}

