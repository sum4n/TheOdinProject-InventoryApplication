const Item = require("../models/item");
const Seller = require("../models/seller");
const Slot = require("../models/slot");
const ItemInstance = require("../models/iteminstance");

const asyncHandler = require("express-async-handler");
const { body, check, validationResult } = require("express-validator");

// Cloudinary configs
const cloudinary = require("cloudinary").v2;
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

exports.index = asyncHandler(async (req, res, next) => {
  // Get details of items, sellers, slots and item instances counts (in paraller)
  const [
    numItems,
    numItemInstances,
    numInStockItemInstances,
    numSellers,
    numSlots,
  ] = await Promise.all([
    Item.countDocuments({}).exec(),
    ItemInstance.countDocuments({}).exec(),
    ItemInstance.countDocuments({ num_of_stocks: { $gt: 0 } }).exec(),
    Seller.countDocuments({}).exec(),
    Slot.countDocuments({}).exec(),
  ]);

  res.render("index", {
    title: "WoW Inventory Home",
    item_count: numItems,
    item_instance_count: numItemInstances,
    item_instance_stock_count: numInStockItemInstances,
    seller_count: numSellers,
    slot_count: numSlots,
  });
});

// Display list of all Item.
exports.item_list = asyncHandler(async (req, res, next) => {
  const allItems = await Item.find({}, "name quality imgUrl")
    .sort({ quality: 1 })
    .populate("slot")
    .exec();

  res.render("item_list", {
    title: "Item List",
    item_list: allItems,
  });
});

// Display detail page for a specific Item.
exports.item_detail = asyncHandler(async (req, res, next) => {
  const [item, itemInstances] = await Promise.all([
    Item.findById(req.params.id).sort({ name: 1 }).populate("slot").exec(),
    ItemInstance.find({ item: req.params.id }).populate("seller").exec(),
  ]);

  if (item === null) {
    // No results
    const err = new Error("Item not found");
    err.status = 404;
    return next(err);
  }

  res.render("item_detail", {
    title: "Item Detail",
    item: item,
    itemInstances: itemInstances,
  });
});

// Display Item create form on GET.
exports.item_create_get = asyncHandler(async (req, res, next) => {
  // Get all slots which can be used for adding to our book.
  const allSlots = await Slot.find({}).exec();

  res.render("item_form", {
    title: "Create Item",
    slots: allSlots,
  });
});

// Handle Item create on POST.
exports.item_create_post = [
  body("name", "Name must not be empty.").trim().isLength({ min: 1 }).escape(),
  body("description", "Description must not be empty.")
    .trim()
    .isLength({ min: 3 })
    .escape(),
  body("quality", "Quality must not be empty.")
    .trim()
    .isLength({ min: 1 })
    .escape(),
  body("slot", "Slot must not be empty").trim().isLength({ min: 1 }).escape(),
  // Validate file. Only image file should be uploaded.
  check("itemImage")
    .custom((value, { req }) => {
      if (!req.file) {
        // There is no file. Pass/skip validation.
        return true;
      }
      if (req.file.mimetype.startsWith("image/")) {
        return true;
      } else {
        return false;
      }
    })
    .withMessage("Please submit a image file"),

  // Process request after validation and sanitization.
  asyncHandler(async (req, res, next) => {
    // Extract the validation errors from a request.
    const errors = validationResult(req);

    // Create an Item object with the escaped and trimmed data.
    const item = new Item({
      name: req.body.name,
      description: req.body.description,
      quality: req.body.quality,
      slot: req.body.slot,
      // imgUrl added before saving the item object.
    });

    if (!errors.isEmpty()) {
      // There are errors. Render form again with sanitized values/error messages.

      // Get all slots for form.
      const allSlots = await Slot.find({}).exec();

      res.render("item_form", {
        title: "Create Item",
        slots: allSlots,
        item: item,
        errors: errors.array(),
      });
      return;
    } else {
      if (req.file) {
        // There is image file, upload it and add its url.
        // Upload image to cloudinary
        const b64 = Buffer.from(req.file.buffer).toString("base64");
        const dataURI = "data:" + req.file.mimetype + ";base64," + b64;
        const uploadedImage = await cloudinary.uploader.upload(dataURI, {
          resource_type: "image",
          folder: "wow_inventory",
        });

        // Add the image's url as item's image url.
        item.imgUrl = uploadedImage.secure_url;
      } else {
        item.imgUrl = "#";
      }

      // Save item.
      await item.save();
      res.redirect(item.url);
    }
  }),
];

// Display Item delete form on GET.
exports.item_delete_get = asyncHandler(async (req, res, next) => {
  // Get details of item and all its instances (in parallel).
  const [item, itemInstances] = await Promise.all([
    Item.findById(req.params.id).exec(),
    ItemInstance.find({ item: req.params.id }).populate("item").exec(),
  ]);

  if (item === null) {
    // No result.
    res.redirect("/catalog/items");
  }

  res.render("item_delete", {
    title: "Delete Item",
    item: item,
    itemInstances: itemInstances,
  });
});

// Handle Item delete on POST.
exports.item_delete_post = asyncHandler(async (req, res, next) => {
  // Get details of item and all its instances (in parallel).
  const [item, itemInstances] = await Promise.all([
    Item.findById(req.params.id).exec(),
    ItemInstance.find({ item: req.params.id }).populate("item").exec(),
  ]);

  if (itemInstances.length > 0 || req.body.security_code != "123") {
    // Item has instances. Render in same way as for GET route.
    res.render("item_delete", {
      title: "Delete Item",
      item: item,
      itemInstances: itemInstances,
      code: req.body.security_code,
      error: "Wrong security code.",
    });
    return;
  } else {
    // Item has no instances. Delete item object and redirect to list of items.
    await Item.findByIdAndDelete(req.body.itemid);
    res.redirect("/catalog/items");
  }
});

// Display Item update form on GET.
exports.item_update_get = asyncHandler(async (req, res, next) => {
  // Get item and its slots for form.
  const [item, slots] = await Promise.all([
    Item.findById(req.params.id).populate("slot").exec(),
    Slot.find({}).sort({ name: 1 }).exec(),
  ]);

  if (item === null) {
    // No results.
    const err = new Error("Item not found");
    err.status = 404;
    return next(err);
  }

  res.render("item_form", {
    title: "Update Item",
    item: item,
    slots: slots,
    form_type: "update",
  });
});

// Handle Item update on POST.
exports.item_update_post = [
  body("name", "Name must not be empty.").trim().isLength({ min: 1 }).escape(),
  body("description", "Description must not be empty.")
    .trim()
    .isLength({ min: 3 })
    .escape(),
  body("quality", "Quality must not be empty.")
    .trim()
    .isLength({ min: 1 })
    .escape(),
  body("slot", "Slot must not be empty").trim().isLength({ min: 1 }).escape(),
  // Validate file. Only image file should be uploaded.
  check("itemImage")
    .custom((value, { req }) => {
      if (!req.file) {
        // There is no file. Pass/skip validation.
        return true;
      }
      if (req.file.mimetype.startsWith("image/")) {
        return true;
      } else {
        return false;
      }
    })
    .withMessage("Please submit a image file"),

  // Process request after validation and sanitization.
  asyncHandler(async (req, res, next) => {
    // Extract the validation errors from a request.
    const errors = validationResult(req);

    // Create an Item object with the escaped and trimmed data.
    const item = new Item({
      name: req.body.name,
      description: req.body.description,
      quality: req.body.quality,
      slot: req.body.slot,
      // imgUrl: req.file ? `/images/${req.file.filename}` : "#",
      _id: req.params.id, // Required, else a new ID will be assigned.
    });

    if (!errors.isEmpty() || req.body.security_code != "123") {
      // There are errors. Render the form again with sanitized values/errors messages.

      // Get item and its slots for form.
      const [item, slots] = await Promise.all([
        Item.findById(req.params.id).populate("slot").exec(),
        Slot.find({}).sort({ name: 1 }).exec(),
      ]);

      res.render("item_form", {
        title: "Update Item",
        item: item,
        slots: slots,
        errors: errors.array(),
        code: req.body.security_code,
        form_type: "update",
        error: req.body.security_code != "123" ? "Wrong security code." : "",
      });
      return;
    } else {
      if (req.file) {
        // There is image file, upload it and add its url.
        // Upload image to cloudinary
        const b64 = Buffer.from(req.file.buffer).toString("base64");
        const dataURI = "data:" + req.file.mimetype + ";base64," + b64;
        const uploadedImage = await cloudinary.uploader.upload(dataURI, {
          resource_type: "image",
          folder: "wow_inventory",
          public_id: item._id,
          overwrite: true,
          invalidate: true,
        });

        // Add the image's url as item's image url.
        item.imgUrl = uploadedImage.secure_url;
      } else {
        item.imgUrl = "#";
      }

      await Item.findByIdAndUpdate(req.params.id, item, {});
      // Redirect to item detail page.
      res.redirect(item.url);
    }
  }),
];
